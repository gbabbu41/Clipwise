import { NextRequest, NextResponse } from "next/server";
import { stripe, PLAN_PRICING } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensurePlansHydrated, getPlanById } from "@/lib/plans-server";

export async function POST(request: NextRequest) {
  const BASE_URL = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { plan, upgrade } = await request.json() as { plan: string; upgrade?: boolean };

  // Pricing is the admin-editable DB plan; fall back to the hardcoded map only
  // if the plans table is missing/empty (pre-migration safety). A purchasable
  // plan must be active with a price > 0 (Starter is free → not a checkout).
  const planRows = await ensurePlansHydrated();
  const dbPlan = getPlanById(planRows, plan);
  let amount: number;
  let planName: string;
  if (dbPlan && dbPlan.is_active && dbPlan.price_cents > 0) {
    amount = dbPlan.price_cents;
    planName = dbPlan.name;
  } else {
    const fallback = PLAN_PRICING[plan];
    if (!fallback) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    amount = fallback.amount;
    planName = fallback.name;
  }

  // For an upgrade from the billing page, capture the existing subscription so the
  // webhook can cancel it once the new plan activates.
  let oldSubscriptionId = "";
  let customerId: string | undefined;
  if (upgrade) {
    const { data: shops } = await supabaseAdmin
      .from("shops").select("name, stripe_subscription_id, stripe_customer_id")
      .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1);
    oldSubscriptionId = shops?.[0]?.stripe_subscription_id ?? "";
    customerId = shops?.[0]?.stripe_customer_id ?? undefined;
    const shopName = shops?.[0]?.name ?? "";
    // Label the Stripe customer with the shop's BUSINESS name so subscription
    // invoices read "To: <Shop>" instead of the cardholder's personal name.
    try {
      if (customerId) {
        if (shopName) await stripe.customers.update(customerId, { name: shopName });
      } else if (shopName) {
        const customer = await stripe.customers.create({ email: user.email ?? undefined, name: shopName });
        customerId = customer.id;
      }
    } catch { /* non-fatal — fall back to an email-only customer */ }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(customerId ? { customer: customerId } : { customer_email: user.email }),
      line_items: [{
        price_data: {
          currency: "cad",
          product_data: { name: planName },
          unit_amount: amount,
          recurring: { interval: "month" },
        },
        quantity: 1,
      }],
      metadata: { user_id: user.id, plan, old_subscription_id: oldSubscriptionId },
      subscription_data: { metadata: { user_id: user.id, plan, old_subscription_id: oldSubscriptionId } },
      success_url: upgrade
        ? `${BASE_URL}/dashboard/billing?upgraded=1&session_id={CHECKOUT_SESSION_ID}`
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
