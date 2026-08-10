import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Create a SetupIntent so the owner can update their SUBSCRIPTION card in-app
 * (Stripe Elements collects the card; the number goes straight to Stripe, never
 * to us). The card is attached to the shop's platform customer; the client then
 * calls /api/stripe/update-card to make it the default.
 *
 * Owner-only, scoped to a shop they own that has a Stripe customer.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { shop_id } = await request.json().catch(() => ({})) as { shop_id?: string };

  // Resolve the caller's shop (explicit shop_id, else newest) and confirm ownership.
  let query = supabaseAdmin.from("shops").select("id, owner_id, stripe_customer_id").eq("owner_id", user.id);
  if (shop_id) query = query.eq("id", shop_id);
  const { data: shops } = await query.order("created_at", { ascending: false }).limit(1);
  const shop = shops?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });
  if (!shop.stripe_customer_id) {
    return NextResponse.json({ error: "No subscription on file — start a plan first." }, { status: 400 });
  }

  try {
    const intent = await stripe.setupIntents.create({
      customer: shop.stripe_customer_id,
      payment_method_types: ["card"],
      usage: "off_session", // this card will be charged for future subscription renewals
    });
    return NextResponse.json({ clientSecret: intent.client_secret });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't start the card update." },
      { status: 500 },
    );
  }
}
