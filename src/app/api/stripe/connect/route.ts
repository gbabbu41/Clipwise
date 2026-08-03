import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Create (or resume) a Stripe Connect Express onboarding link for the owner's shop
export async function POST(request: NextRequest) {
  const BASE_URL = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const shopId = body.shop_id as string | undefined;

  // Find the shop to connect (explicit shop_id, else the owner's most recent shop)
  let query = supabaseAdmin.from("shops").select("*").eq("owner_id", user.id);
  if (shopId) query = query.eq("id", shopId);
  const { data: shops } = await query.order("created_at", { ascending: false }).limit(1);
  const shop = shops?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  try {
    let accountId = shop.stripe_account_id as string | null;

    // Create an Express account if the shop doesn't have one yet
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "CA",
        email: shop.email || user.email,
        business_type: "individual",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: { name: shop.name, url: `${BASE_URL}/book/${shop.slug}` },
        metadata: { shop_id: shop.id },
      });
      accountId = account.id;
      await supabaseAdmin.from("shops")
        .update({ stripe_account_id: accountId, stripe_connect_status: "pending" })
        .eq("id", shop.id);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${BASE_URL}/onboarding/stripe-connect?refresh=1`,
      return_url: `${BASE_URL}/dashboard?connect=done`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
