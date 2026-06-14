import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";

// In-person POS card sale → hosted Stripe Checkout on the shop's connected
// account (platform-charge fallback when Connect KYC isn't done, so sandbox
// works out of the box). The transaction is NOT recorded here; it's created
// on return via /pos-finalize after Stripe confirms the payment.
export async function POST(request: NextRequest) {
  const body = await request.json() as {
    shop_id: string;
    origin: string;
    barber_id: string | null;
    client_name: string;
    client_email: string;
    client_phone: string;
    service_name: string;
    subtotal: number;
    tip: number;
    discount: number;
    total: number;
    commission_amount: number | null;
    type: string;
    products: { id: string; qty: number }[];
  };

  if (!body.shop_id || !body.total || body.total <= 0) {
    return NextResponse.json({ error: "Invalid sale" }, { status: 400 });
  }

  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("name, stripe_account_id, stripe_connected, subscription_plan, subscription_status")
    .eq("id", body.shop_id).single();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  // Card payments are a paid feature (same gate as online bookings).
  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "payments")) {
    return NextResponse.json({ error: "Card payments require a paid plan." }, { status: 403 });
  }

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);

  // Require Stripe Connect to take card — never platform-charge, so the money
  // always lands in the shop's own account. Cash still works in the POS.
  if (!useConnect) {
    return NextResponse.json(
      { error: "Card payments aren't set up yet — finish Stripe Connect in Billing. You can still take cash." },
      { status: 409 },
    );
  }

  const origin = body.origin || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "cad",
            product_data: { name: `${body.service_name || "Sale"} — ${shop.name}` },
            unit_amount: Math.round(body.total * 100),
          },
          quantity: 1,
        }],
        // Drives the emailed Stripe receipt.
        customer_email: body.client_email || undefined,
        payment_intent_data: body.client_email ? { receipt_email: body.client_email } : undefined,
        metadata: {
          flow: "pos_sale",
          shop_id: body.shop_id,
          barber_id: body.barber_id ?? "",
          client_name: body.client_name,
          client_email: body.client_email,
          client_phone: body.client_phone,
          service_name: body.service_name,
          subtotal: String(body.subtotal),
          tip: String(body.tip),
          discount: String(body.discount ?? 0),
          total: String(body.total),
          commission_amount: body.commission_amount != null ? String(body.commission_amount) : "",
          type: body.type,
          // Compact product list for inventory decrement on finalize.
          products: JSON.stringify(body.products ?? []).slice(0, 480),
        },
        success_url: `${origin}/dashboard/pos?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/dashboard/pos?cancelled=1`,
      },
      useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined
    );
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
