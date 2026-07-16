import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";

// Customer buys a gift card online → hosted Stripe Checkout on the shop's
// connected account. The gift_cards row is NOT created here; it's created on
// return via /gift-finalize once Stripe confirms payment (so an abandoned
// checkout never mints a card). Mirrors pos-checkout: Connect required, so the
// money always lands in the shop's own account.
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

export async function POST(request: NextRequest) {
  const b = await request.json() as {
    shop_slug: string; origin: string; amount: number;
    recipient_name?: string; recipient_email?: string;
    purchaser_name?: string; purchaser_email?: string; note?: string;
  };
  const amount = Number(b.amount);
  if (!b.shop_slug || !amount || amount <= 0) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  if (amount > 1000) return NextResponse.json({ error: "Maximum gift card is $1000" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, slug, status, stripe_account_id, stripe_connected, subscription_plan, subscription_status")
    .eq("slug", b.shop_slug).maybeSingle();
  if (!shop || shop.status !== "approved") return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "loyalty")) return NextResponse.json({ error: "Gift cards aren't available for this shop." }, { status: 403 });

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
  if (!useConnect) return NextResponse.json({ error: "This shop can't sell gift cards online yet." }, { status: 409 });

  const origin = b.origin || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const code = generateCode();

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "cad",
            product_data: { name: `${shop.name} — Gift Card` },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        customer_email: b.purchaser_email || undefined,
        payment_intent_data: b.purchaser_email ? { receipt_email: b.purchaser_email } : undefined,
        metadata: {
          flow: "gift_card_purchase",
          shop_id: shop.id,
          code,
          amount: String(amount),
          recipient_name: (b.recipient_name ?? "").slice(0, 120),
          recipient_email: (b.recipient_email ?? "").slice(0, 160),
          purchaser_name: (b.purchaser_name ?? "").slice(0, 120),
          purchaser_email: (b.purchaser_email ?? "").slice(0, 160),
          note: (b.note ?? "").slice(0, 200),
        },
        success_url: `${origin}/gift/${shop.slug}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/gift/${shop.slug}?cancelled=1`,
      },
      { stripeAccount: shop.stripe_account_id! },
    );
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
