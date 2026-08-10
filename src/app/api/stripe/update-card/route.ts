import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Make a just-saved card (from the in-app SetupIntent flow) the DEFAULT payment
 * method for the shop's subscription — so future renewals charge the new card.
 * The card is already attached to the customer by the SetupIntent; here we only
 * set it as default on the customer AND the active subscription.
 *
 * Owner-only. `payment_method` is verified to belong to THIS shop's customer
 * before it's used, so a crafted request can't attach another customer's card.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { payment_method, shop_id } = await request.json().catch(() => ({})) as {
    payment_method?: string; shop_id?: string;
  };
  if (!payment_method) return NextResponse.json({ error: "Missing card" }, { status: 400 });

  let query = supabaseAdmin.from("shops").select("id, owner_id, stripe_customer_id, stripe_subscription_id").eq("owner_id", user.id);
  if (shop_id) query = query.eq("id", shop_id);
  const { data: shops } = await query.order("created_at", { ascending: false }).limit(1);
  const shop = shops?.[0];
  if (!shop || !shop.stripe_customer_id) {
    return NextResponse.json({ error: "No subscription on file." }, { status: 400 });
  }

  try {
    // Verify the payment method actually belongs to this shop's customer — never
    // trust a client-supplied id to point at another customer's card.
    const pm = await stripe.paymentMethods.retrieve(payment_method);
    if (pm.customer !== shop.stripe_customer_id) {
      return NextResponse.json({ error: "That card isn't on this account." }, { status: 403 });
    }

    await stripe.customers.update(shop.stripe_customer_id, {
      invoice_settings: { default_payment_method: payment_method },
    });
    if (shop.stripe_subscription_id) {
      await stripe.subscriptions.update(shop.stripe_subscription_id, {
        default_payment_method: payment_method,
      });
    }

    const last4 = pm.card?.last4 ?? null;
    return NextResponse.json({ ok: true, last4 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't update the card." },
      { status: 500 },
    );
  }
}
