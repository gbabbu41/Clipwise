import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAppEmail } from "@/lib/emailer";

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

    // Deliver the code (recipient) + a receipt (buyer), best-effort.
    const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const bookUrl = `${baseUrl}/book/${shop.slug}`;
    const cardHtml = (heading: string, intro: string) => `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="color:#111;margin:0 0 8px;">${heading}</h2>
      <p style="color:#444;line-height:1.6;">${intro}</p>
      <div style="margin:20px 0;padding:20px;border:2px dashed #bbb;border-radius:14px;text-align:center;">
        <div style="font-size:12px;color:#888;letter-spacing:1px;">GIFT CARD · ${shop.name}</div>
        <div style="font-size:28px;font-weight:800;color:#111;margin:8px 0;">$${amount.toFixed(2)}</div>
        <div style="font-size:20px;font-weight:700;letter-spacing:2px;color:#111;font-family:monospace;">${code}</div>
      </div>
      ${m.note ? `<p style="color:#444;font-style:italic;">“${m.note}”</p>` : ""}
      <a href="${bookUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;">Book an appointment →</a>
      <p style="margin-top:20px;font-size:12px;color:#999;">Redeemable at ${shop.name}. Present this code at checkout.</p>
    </div>`;

    // Send in-process (no HTTP hop, no shared secret) so gift-card emails
    // never silently fail when CRON_SECRET isn't set.
    const sendMail = async (to: string, subject: string, htmlBody: string) => {
      await sendAppEmail("marketing_campaign", { to, subject, htmlBody, shopEmail: shop!.email ?? "" }).catch(() => null);
    };
    if (m.recipient_email) {
      await sendMail(m.recipient_email, `You've got a gift card for ${shop.name}! 🎁`,
        cardHtml(`A gift for you 🎁`, `${m.purchaser_name || "Someone"} sent you a $${amount.toFixed(2)} gift card for ${shop.name}.`));
    }
    if (m.purchaser_email && m.purchaser_email !== m.recipient_email) {
      await sendMail(m.purchaser_email, `Your gift card purchase — ${shop.name}`,
        cardHtml(`Thanks for your purchase`, `Your $${amount.toFixed(2)} gift card for ${shop.name}${m.recipient_name ? ` for ${m.recipient_name}` : ""} is ready.`));
    }

    return NextResponse.json({ paid: true, code, amount });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
