import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { LOCATION_ADDON_LOOKUP_KEY } from "@/lib/stripe-addons";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = new URL(request.url).searchParams.get("shop_id");
  let query = supabaseAdmin.from("shops").select("*").eq("owner_id", user.id);
  if (shopId) query = query.eq("id", shopId);
  const { data: shops } = await query.order("created_at", { ascending: false }).limit(1);
  const shop = shops?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  const result: {
    plan: string;
    subscriptionStatus: string;
    nextBilling: string | null;
    amount: number | null;
    cardLast4: string | null;
    invoices: { id: string; amount: number; date: number; status: string; url: string | null }[];
    connect: { connected: boolean; status: string };
  } = {
    plan: shop.subscription_plan ?? "starter",
    subscriptionStatus: shop.subscription_status ?? "inactive",
    nextBilling: null,
    amount: null,
    cardLast4: null,
    invoices: [],
    connect: { connected: !!shop.stripe_connected, status: shop.stripe_connect_status ?? "pending" },
  };

  // Pull live subscription details
  if (shop.stripe_subscription_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(shop.stripe_subscription_id, {
        expand: ["default_payment_method"],
      }) as unknown as Stripe.Subscription & { current_period_end?: number };
      result.subscriptionStatus = sub.status === "active" || sub.status === "trialing" ? "active"
        : sub.status === "past_due" || sub.status === "unpaid" ? "past_due" : "cancelled";
      // Use the PLAN line item (not [0]): a subscription can also carry the
      // $30/location add-on item, and Stripe doesn't guarantee item order, so
      // [0] could be the add-on — which would show $30 as the plan price/period.
      const planItem = (sub.items.data.find(i => i.price?.lookup_key !== LOCATION_ADDON_LOOKUP_KEY) ?? sub.items.data[0]) as (typeof sub.items.data[0] & { current_period_end?: number }) | undefined;
      const periodEnd = planItem?.current_period_end ?? sub.current_period_end;
      result.nextBilling = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
      result.amount = planItem?.price.unit_amount ? planItem.price.unit_amount / 100 : null;
      // Card: prefer subscription's default PM, fall back to the customer's default PM
      let pm = sub.default_payment_method as Stripe.PaymentMethod | string | null;
      if (pm && typeof pm !== "string" && pm.card) {
        result.cardLast4 = pm.card.last4;
      } else if (shop.stripe_customer_id) {
        const cust = await stripe.customers.retrieve(shop.stripe_customer_id, { expand: ["invoice_settings.default_payment_method"] }) as Stripe.Customer;
        pm = cust.invoice_settings?.default_payment_method as Stripe.PaymentMethod | null;
        if (pm && typeof pm !== "string" && pm.card) result.cardLast4 = pm.card.last4;
      }
    } catch { /* subscription may be gone — leave defaults */ }
  }

  // Invoice history
  if (shop.stripe_customer_id) {
    try {
      const invoices = await stripe.invoices.list({ customer: shop.stripe_customer_id, limit: 12 });
      result.invoices = invoices.data.map(inv => ({
        id: inv.number ?? inv.id ?? "",
        amount: (inv.amount_paid ?? 0) / 100,
        date: inv.created,
        status: inv.status ?? "unknown",
        url: inv.hosted_invoice_url ?? null,
      }));
    } catch { /* ignore */ }
  }

  return NextResponse.json(result);
}
