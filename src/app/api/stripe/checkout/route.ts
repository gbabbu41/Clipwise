import { NextRequest, NextResponse } from "next/server";
import { stripe, PLAN_PRICING } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensurePlansHydrated, getPlanById } from "@/lib/plans-server";

export async function POST(request: NextRequest) {
  const BASE_URL = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
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
  // When the owner is on a no-card trial and adds a card to keep their plan, we
  // save the card now but defer the FIRST charge to the original trial end — so
  // they keep every remaining free day instead of being billed on the spot.
  let trialEndUnix: number | undefined;
  if (upgrade) {
    const { data: shops } = await supabaseAdmin
      .from("shops").select("name, stripe_subscription_id, stripe_customer_id, trial_ends_at, subscription_status")
      .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1);
    oldSubscriptionId = shops?.[0]?.stripe_subscription_id ?? "";
    customerId = shops?.[0]?.stripe_customer_id ?? undefined;
    const shopName = shops?.[0]?.name ?? "";

    // Honor the remaining trial. Only for a genuine active no-card trial (a
    // trial_ends_at in the future, no existing Stripe subscription — so a paid
    // subscriber switching plans can't mint themselves a fresh free trial).
    // Stripe requires trial_end ≥ ~48h out; inside that window we push to the
    // minimum (now + 49h) instead of billing on the spot — so a card added on the
    // last day still honors "keep all your remaining free days" (errs toward a
    // little more free time, never charging early).
    const rawTrialEnd = shops?.[0]?.trial_ends_at ? new Date(shops[0].trial_ends_at as string).getTime() : 0;
    if (!oldSubscriptionId
      && shops?.[0]?.subscription_status === "active"
      && rawTrialEnd > Date.now()) {
      const minEndMs = Date.now() + 49 * 3600 * 1000;
      trialEndUnix = Math.floor(Math.max(rawTrialEnd, minEndMs) / 1000);
    }
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
      subscription_data: {
        metadata: { user_id: user.id, plan, old_subscription_id: oldSubscriptionId },
        // Defer the first charge to the original trial end when honoring a trial.
        ...(trialEndUnix ? { trial_end: trialEndUnix } : {}),
      },
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
