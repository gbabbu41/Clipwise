import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

// Customer pays for a booking — charge runs on the shop's connected account (0% platform fee).
// The appointment is NOT created here; it's created on success via /booking-finalize.
export async function POST(request: NextRequest) {
  const booking = await request.json() as {
    shop_id: string;
    shop_slug: string;
    barber_id: string | null;
    service_id: string;
    service_name: string;
    client_name: string;
    client_email: string;
    client_phone: string;
    date: string;
    time_slot: string;
    amount: number; // dollars to charge now (deposit or full)
    total_amount: number; // full appointment total
  };

  const { data: shop } = await supabaseAdmin
    .from("shops").select("stripe_account_id, stripe_connected, subscription_plan, subscription_status")
    .eq("id", booking.shop_id).single();

  if (!shop?.stripe_account_id || !shop.stripe_connected) {
    return NextResponse.json({ error: "This shop is not set up to accept online payments yet." }, { status: 400 });
  }

  // Online payments are a Pro/Premium feature
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "payments")) {
    return NextResponse.json({ error: "Online payments require a Pro or Premium plan." }, { status: 403 });
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "cad",
            product_data: { name: `${booking.service_name} — deposit` },
            unit_amount: Math.round(booking.amount * 100),
          },
          quantity: 1,
        }],
        metadata: {
          shop_id: booking.shop_id,
          barber_id: booking.barber_id ?? "",
          service_id: booking.service_id,
          client_name: booking.client_name,
          client_email: booking.client_email,
          client_phone: booking.client_phone,
          date: booking.date,
          time_slot: booking.time_slot,
          total_amount: String(booking.total_amount),
        },
        success_url: `${BASE_URL}/book/${booking.shop_slug}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${BASE_URL}/book/${booking.shop_slug}?cancelled=1`,
      },
      { stripeAccount: shop.stripe_account_id } // direct charge on connected account → 0% platform fee
    );

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
