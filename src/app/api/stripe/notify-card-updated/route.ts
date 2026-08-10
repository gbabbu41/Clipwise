import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe, PLAN_PRICING } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAppEmail } from "@/lib/emailer";

/**
 * Send the owner a confirmation email after they successfully update their
 * subscription card (Stripe's card page → back to Billing with ?card_updated=1,
 * which triggers this). Reads the live card + next-billing from Stripe so the
 * email states the real card/date, not client-supplied values. Best-effort —
 * never surfaces an error to the UI (the card change already succeeded).
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ ok: false }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ ok: false }, { status: 401 });

  // The subscription lives on one customer for the owner — pick any shop holding it.
  const { data: shops } = await supabaseAdmin
    .from("shops").select("name, email, subscription_plan, stripe_customer_id, stripe_subscription_id")
    .eq("owner_id", user.id).order("created_at", { ascending: false });
  const shop = (shops ?? []).find(s => s.stripe_customer_id) ?? null;
  if (!shop?.stripe_customer_id) return NextResponse.json({ ok: false });

  const ownerEmail = user.email || shop.email || "";
  if (!ownerEmail) return NextResponse.json({ ok: false });

  try {
    // Live card on file (newest attached card).
    let cardLabel = "";
    const pms = await stripe.paymentMethods.list({ customer: shop.stripe_customer_id, type: "card", limit: 1 });
    const c = pms.data[0]?.card;
    if (c) cardLabel = `${c.brand.replace(/^(\w)/, m => m.toUpperCase())} •••• ${c.last4}`;

    // Next billing date from the subscription.
    let nextBilling = "";
    if (shop.stripe_subscription_id) {
      const sub = await stripe.subscriptions.retrieve(shop.stripe_subscription_id) as unknown as Stripe.Subscription & { current_period_end?: number };
      const end = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
      if (end) nextBilling = new Date(end * 1000).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });
    }

    const planName = PLAN_PRICING[shop.subscription_plan ?? ""]?.name || "subscription";

    await sendAppEmail("subscription_card_updated", {
      ownerEmail,
      shopName: shop.name ?? "",
      planName,
      cardLabel,
      nextBilling,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
