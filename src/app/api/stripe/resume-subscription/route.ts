import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isNativeRequest } from "@/lib/native-app";

// Undo a scheduled cancel (before the period ends). Flips cancel_at_period_end
// back off so the subscription keeps renewing normally.
export async function POST(request: NextRequest) {
  // Apple IAP: resuming is a ClipWise-subscription action — never from the app.
  // (Matches the other subscription routes; managed on clipwise.ca.)
  if (isNativeRequest(request)) {
    return NextResponse.json({ error: "Not available in the app." }, { status: 403 });
  }
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)
    || (body.shop_id !== undefined && (typeof body.shop_id !== "string" || !body.shop_id || body.shop_id.length > 100))) {
    return NextResponse.json({ error: "Invalid subscription request." }, { status: 400 });
  }
  const { shop_id } = body as { shop_id?: string };

  // Scope to the shop being viewed (fall back to newest), constrained to the
  // owner's shops — mirrors cancel-subscription so resume undoes the same sub.
  let shopQ = supabaseAdmin.from("shops").select("id, stripe_subscription_id").eq("owner_id", user.id);
  shopQ = shop_id ? shopQ.eq("id", shop_id) : shopQ.order("created_at", { ascending: false });
  const { data: shops, error: readError } = await shopQ.limit(1);
  if (readError) return NextResponse.json({ error: "Couldn't check your subscription. Please try again." }, { status: 503 });
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
