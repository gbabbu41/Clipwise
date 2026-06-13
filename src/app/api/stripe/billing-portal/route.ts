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

  const { data: shops } = await supabaseAdmin
    .from("shops").select("stripe_customer_id").eq("owner_id", user.id)
    .order("created_at", { ascending: false }).limit(1);
  const customerId = shops?.[0]?.stripe_customer_id;
  if (!customerId) return NextResponse.json({ error: "No subscription to manage yet." }, { status: 400 });

  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/dashboard/billing`,
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
