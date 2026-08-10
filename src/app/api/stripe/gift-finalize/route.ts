import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { finalizeGiftFromSession } from "@/lib/finalize-gift-session";

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

    const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
    const r = await finalizeGiftFromSession(session, shop, baseUrl);
    if (r.status === "created" || r.status === "already") {
      return NextResponse.json({ paid: true, code: r.code, amount: r.amount, already: r.status === "already" });
    }
    if (r.status === "error") {
      console.error("[gift-finalize] mint failed:", r.message);
      return NextResponse.json({ error: "Couldn't finish the gift card. Please try again." }, { status: 500 });
    }
    if (r.status === "mismatch") return NextResponse.json({ error: "Session mismatch" }, { status: 400 });
    return NextResponse.json({ paid: false });
  } catch (err) {
    console.error("[gift-finalize]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't finish the gift card. Please try again." }, { status: 500 });
  }
}
