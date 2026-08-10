import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { LOCATION_ADDON_LOOKUP_KEY, AI_PHONE_ADDON_LOOKUP_KEY } from "@/lib/stripe-addons";

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
    cardBrand: string | null;
    cancelAtPeriodEnd: boolean;
    invoices: { id: string; amount: number; date: number; status: string; url: string | null }[];
    connect: {
      connected: boolean; status: string;
      chargesEnabled?: boolean; payoutsEnabled?: boolean; detailsSubmitted?: boolean; checkError?: boolean;
    };
  } = {
    plan: shop.subscription_plan ?? "starter",
    subscriptionStatus: shop.subscription_status ?? "inactive",
    nextBilling: null,
    amount: null,
    cardLast4: null,
    cardBrand: null,
    cancelAtPeriodEnd: false,
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
      const ADDON_KEYS = new Set([LOCATION_ADDON_LOOKUP_KEY, AI_PHONE_ADDON_LOOKUP_KEY]);
      const planItem = (sub.items.data.find(i => !ADDON_KEYS.has(i.price?.lookup_key ?? "")) ?? sub.items.data[0]) as (typeof sub.items.data[0] & { current_period_end?: number }) | undefined;
      const periodEnd = planItem?.current_period_end ?? sub.current_period_end;
      result.nextBilling = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
      // When a cancel is scheduled, Stripe keeps the sub active until period end
      // (they keep what they paid for) — surface it so the UI can show it + a Resume.
      result.cancelAtPeriodEnd = !!sub.cancel_at_period_end;
      result.amount = planItem?.price.unit_amount ? planItem.price.unit_amount / 100 : null;
      // Card on file — check in order: the subscription's default PM, the
      // customer's invoice default PM, then ANY card attached to the customer.
      // The last one matters: a card can be attached + charged WITHOUT being
      // flagged "default" (common right after Checkout), which is exactly why
      // Payment method used to show blank ("—") on an active, billing plan.
      const readCard = (pm: unknown): { last4: string; brand: string } | null => {
        if (pm && typeof pm !== "string" && (pm as Stripe.PaymentMethod).card) {
          const c = (pm as Stripe.PaymentMethod).card!;
          return { last4: c.last4, brand: c.brand };
        }
        return null;
      };
      let card = readCard(sub.default_payment_method);
      if (!card && shop.stripe_customer_id) {
        const cust = await stripe.customers.retrieve(shop.stripe_customer_id, { expand: ["invoice_settings.default_payment_method"] }) as Stripe.Customer;
        card = readCard(cust.invoice_settings?.default_payment_method);
      }
      if (!card && shop.stripe_customer_id) {
        const pms = await stripe.paymentMethods.list({ customer: shop.stripe_customer_id, type: "card", limit: 1 });
        card = readCard(pms.data[0]);
      }
      if (card) { result.cardLast4 = card.last4; result.cardBrand = card.brand; }
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

  // Connect status — verify against the LIVE Stripe account, not just the cached
  // `stripe_connected` boolean (which drifts if an account.updated webhook is
  // missed → a fully onboarded shop wrongly reads "Not connected"). Self-heal the
  // shop row so Billing AND every payment route that gates on stripe_connected
  // see the truth. Same "active = charges + payouts enabled" definition as
  // /api/stripe/connect/status.
  if (shop.stripe_account_id) {
    try {
      const account = await stripe.accounts.retrieve(shop.stripe_account_id);
      const active = !!(account.charges_enabled && account.payouts_enabled);
      // Report the true granular state so the UI can distinguish "fully
      // connected" from "onboarded but Stripe is still verifying payouts" — the
      // latter used to read as a flat, confusing "Not connected".
      result.connect = {
        connected: active,
        status: active ? "active" : account.details_submitted ? "pending" : "incomplete",
        chargesEnabled: !!account.charges_enabled,
        payoutsEnabled: !!account.payouts_enabled,
        detailsSubmitted: !!account.details_submitted,
      };
      if (active !== !!shop.stripe_connected) {
        await supabaseAdmin.from("shops")
          .update({ stripe_connected: active, stripe_connect_status: active ? "active" : "pending" })
          .eq("id", shop.id).then(null, () => null);
      }
    } catch {
      // Account fetch failed (e.g. a test/live key mismatch on the stored
      // account id) — don't silently claim "Not connected"; flag it so the card
      // can say we couldn't verify rather than mislead.
      result.connect = { ...result.connect, checkError: true };
    }
  }

  return NextResponse.json(result);
}
