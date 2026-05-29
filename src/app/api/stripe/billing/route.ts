import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

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
      }) as unknown as Stripe.Subscription & { current_period_end: number };
      result.subscriptionStatus = sub.status === "active" || sub.status === "trialing" ? "active"
        : sub.status === "past_due" || sub.status === "unpaid" ? "past_due" : "cancelled";
      result.nextBilling = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
      result.amount = sub.items.data[0]?.price.unit_amount ? sub.items.data[0].price.unit_amount / 100 : null;
      const pm = sub.default_payment_method as Stripe.PaymentMethod | null;
      if (pm && typeof pm !== "string" && pm.card) result.cardLast4 = pm.card.last4;
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
