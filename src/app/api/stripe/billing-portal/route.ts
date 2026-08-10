import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Opens the Stripe-hosted Customer Portal for the owner's subscription, where
// they can cancel (at period end — no refund, keeps access for the rest of the
// paid period), update their card, and view invoices. Stripe handles the UI +
// the cancellation email; our DB is kept in sync by the subscription webhooks.
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The subscription lives on ONE Stripe customer for the owner. Pick any of
  // their shops that actually holds it — not just the newest shop, which for a
  // multi-location owner can be a location with no customer id (that used to
  // wrongly say "No subscription to manage").
  const { data: shops } = await supabaseAdmin
    .from("shops").select("name, stripe_customer_id").eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  const shopWithCustomer = (shops ?? []).find(s => s.stripe_customer_id) ?? null;
  const customerId = shopWithCustomer?.stripe_customer_id;
  if (!customerId) return NextResponse.json({ error: "No subscription to manage yet." }, { status: 400 });

  // Back-fill the customer's name with the shop's business name (fixes invoices
  // that previously showed the cardholder's personal name).
  if (shopWithCustomer?.name) {
    await stripe.customers.update(customerId, { name: shopWithCustomer.name }).catch(() => null);
  }

  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
  try {
    // Land the owner STRAIGHT on Stripe's card-update screen (not the general
    // portal) — Stripe collects + validates the new card there, then returns
    // them to Billing. `payment_method_update` is on by default in the Customer
    // Portal config; if it's ever disabled the catch below surfaces the reason.
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/dashboard/billing`,
      flow_data: { type: "payment_method_update" },
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Most common cause: the Customer Portal hasn't been activated in the Stripe
    // dashboard (Settings → Billing → Customer portal).
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not open billing portal" },
      { status: 500 },
    );
  }
}
