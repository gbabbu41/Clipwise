import { NextRequest, NextResponse } from "next/server";
import { stripe, PLAN_PRICING } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { plan, upgrade } = await request.json() as { plan: string; upgrade?: boolean };
  const pricing = PLAN_PRICING[plan];
  if (!pricing) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

  // For an upgrade from the billing page, capture the existing subscription so the
  // webhook can cancel it once the new plan activates.
  let oldSubscriptionId = "";
  let customerId: string | undefined;
  if (upgrade) {
    const { data: shops } = await supabaseAdmin
      .from("shops").select("stripe_subscription_id, stripe_customer_id")
      .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1);
    oldSubscriptionId = shops?.[0]?.stripe_subscription_id ?? "";
    customerId = shops?.[0]?.stripe_customer_id ?? undefined;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(customerId ? { customer: customerId } : { customer_email: user.email }),
      line_items: [{
        price_data: {
          currency: "cad",
          product_data: { name: pricing.name },
          unit_amount: pricing.amount,
          recurring: { interval: "month" },
        },
        quantity: 1,
      }],
      metadata: { user_id: user.id, plan, old_subscription_id: oldSubscriptionId },
      subscription_data: { metadata: { user_id: user.id, plan, old_subscription_id: oldSubscriptionId } },
      success_url: upgrade
        ? `${BASE_URL}/dashboard/billing?upgraded=1`
        : `${BASE_URL}/onboarding/plan?status=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: upgrade
        ? `${BASE_URL}/dashboard/billing`
        : `${BASE_URL}/onboarding/plan?status=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
