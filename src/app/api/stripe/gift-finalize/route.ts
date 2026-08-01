import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendGiftCardEmails } from "@/lib/gift-card-server";

// Called when the customer returns from a paid gift-card checkout. Verifies the
// payment on the connected account, then creates the gift_cards row (idempotent
// via the unique (shop_id, upper(code)) index), records the sale as revenue,
// and emails the code to the recipient + a confirmation to the buyer.
export async function POST(request: NextRequest) {
  const { session_id, shop_slug } = await request.json() as { session_id: string; shop_slug: string };
  if (!session_id || !shop_slug) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, email, slug, stripe_account_id, stripe_connected").eq("slug", shop_slug).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);

  try {
    const session = await stripe.checkout.sessions.retrieve(
      session_id, undefined, useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined,
    );
    if (session.payment_status !== "paid") return NextResponse.json({ paid: false });

    const m = session.metadata ?? {};
    if (m.flow !== "gift_card_purchase" || m.shop_id !== shop.id) {
      return NextResponse.json({ error: "Session mismatch" }, { status: 400 });
    }
    const code = m.code!;
    const amount = Number(m.amount ?? 0);

    // Idempotency: if this code already exists (page reloaded), just return it.
    const { data: existing } = await supabaseAdmin
      .from("gift_cards").select("code, initial_value").eq("shop_id", shop.id).eq("code", code).maybeSingle();
    if (existing) return NextResponse.json({ paid: true, code: existing.code, amount: existing.initial_value, already: true });

    const { error: insErr } = await supabaseAdmin.from("gift_cards").insert({
      shop_id: shop.id,
      code,
      initial_value: amount,
      remaining_value: amount,
      purchased_by: m.purchaser_name || null,
      purchased_by_email: m.purchaser_email || null,
      recipient_name: m.recipient_name || null,
      recipient_email: m.recipient_email || null,
      note: m.note || null,
      is_active: true,
    });
    // A concurrent finalize may have won the race (unique index) — treat as done.
    if (insErr && !/duplicate|unique/i.test(insErr.message)) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // Record the sale as revenue (mirrors owner-issued gift cards).
    await supabaseAdmin.from("transactions").insert({
      shop_id: shop.id, barber_id: null,
      client_name: m.purchaser_name || "Gift card",
      service_name: `Gift Card ${code}`,
      amount, tip: 0, commission_amount: null,
      payment_method: "card", type: "product", source: "gift_card_sale",
    }).then(null, () => null);

    // Deliver the code (recipient) + a receipt (buyer), best-effort — shared with
    // the owner cash/portal issuance so every gift card looks identical.
    const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    await sendGiftCardEmails({
      shop: { name: shop.name, slug: shop.slug, email: shop.email },
      baseUrl,
      meta: {
        code, amount, note: m.note,
        recipient_name: m.recipient_name, recipient_email: m.recipient_email,
        purchaser_name: m.purchaser_name, purchaser_email: m.purchaser_email,
      },
    });

    return NextResponse.json({ paid: true, code, amount });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
