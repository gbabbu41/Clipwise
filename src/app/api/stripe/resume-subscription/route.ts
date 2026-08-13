import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Undo a scheduled cancel (before the period ends). Flips cancel_at_period_end
// back off so the subscription keeps renewing normally.
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { shop_id } = await request.json().catch(() => ({})) as { shop_id?: string };

  // Scope to the shop being viewed (fall back to newest), constrained to the
  // owner's shops — mirrors cancel-subscription so resume undoes the same sub.
  let shopQ = supabaseAdmin.from("shops").select("id, stripe_subscription_id").eq("owner_id", user.id);
  shopQ = shop_id ? shopQ.eq("id", shop_id) : shopQ.order("created_at", { ascending: false });
  const { data: shops } = await shopQ.limit(1);
  const shop = shops?.[0];
  if (!shop?.stripe_subscription_id) return NextResponse.json({ error: "No subscription to resume." }, { status: 400 });

  try {
    await stripe.subscriptions.update(shop.stripe_subscription_id, { cancel_at_period_end: false });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Generic message to the client; real detail stays in the server logs.
    console.error("[resume-subscription] error", err);
    return NextResponse.json({ error: "Couldn't resume — please try again." }, { status: 500 });
  }
}
