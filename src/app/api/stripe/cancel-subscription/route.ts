import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: shops } = await supabaseAdmin
    .from("shops").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1);
  const shop = shops?.[0];
  if (!shop?.stripe_subscription_id) return NextResponse.json({ error: "No active subscription" }, { status: 400 });

  try {
    await stripe.subscriptions.cancel(shop.stripe_subscription_id);
    // Reflect immediately (webhook customer.subscription.deleted will also fire)
    await supabaseAdmin.from("shops")
      .update({ subscription_status: "cancelled", subscription_plan: "starter" })
      .eq("id", shop.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
