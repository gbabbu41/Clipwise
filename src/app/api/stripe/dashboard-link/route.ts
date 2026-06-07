import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Generate a one-time Stripe Express dashboard login link for the shop's
 * connected account, so the owner can jump straight to the authoritative
 * record of charges, refunds, and payouts without a separate Stripe login.
 *
 * Express-account only (createLoginLink). Standard accounts log in at
 * dashboard.stripe.com directly — surfaced as an error if it ever happens.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: userData } = await supabaseAdmin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { shop_id } = await request.json() as { shop_id?: string };
  if (!shop_id) return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("owner_id, stripe_account_id, stripe_connected").eq("id", shop_id).single();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  if (shop.owner_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!shop.stripe_account_id || !shop.stripe_connected) {
    return NextResponse.json(
      { error: "Connect your Stripe account (Billing) before opening the Stripe dashboard." },
      { status: 400 },
    );
  }

  try {
    const link = await stripe.accounts.createLoginLink(shop.stripe_account_id);
    return NextResponse.json({ url: link.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
