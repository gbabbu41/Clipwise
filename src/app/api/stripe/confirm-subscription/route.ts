import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Called by the Billing page when the owner returns from a subscription
// Checkout (upgrade/switch). Verifies the session and applies the plan to the
// owner's shop synchronously — so it works even when the platform webhook isn't
// wired to receive subscription events. Idempotent (safe to call twice).
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { session_id } = await request.json() as { session_id?: string };
  if (!session_id) return NextResponse.json({ error: "Missing session_id" }, { status: 400 });

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id);
  } catch {
    return NextResponse.json({ error: "Could not verify payment" }, { status: 400 });
  }

  const meta = session.metadata ?? {};
  // The session must belong to this user (metadata carries the buyer's user_id).
  if (meta.user_id && meta.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const paid = session.payment_status === "paid" || session.status === "complete";
  if (session.mode !== "subscription" || !paid) {
    return NextResponse.json({ ok: false, paid: false });
  }

  const planId = meta.plan || null;
  const newSubId = typeof session.subscription === "string" ? session.subscription : null;
  const customerId = typeof session.customer === "string" ? session.customer : null;
  const oldSubId = meta.old_subscription_id || "";

  const { data: shops } = await supabaseAdmin
    .from("shops").select("id, name, email, subscription_plan, subscription_status")
    .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1);
  const shop = shops?.[0];
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  // Label the Stripe customer with the shop's business name so invoices read
  // "To: <Shop>" rather than the cardholder's personal name.
  if (customerId && shop.name) {
    await stripe.customers.update(customerId, { name: shop.name }).catch(() => null);
  }

  const { error: updErr } = await supabaseAdmin.from("shops").update({
    subscription_status: "active",
    stripe_subscription_id: newSubId,
    stripe_customer_id: customerId,
    ...(planId ? { subscription_plan: planId } : {}),
  }).eq("id", shop.id);
  if (updErr) {
    // Most likely the prevent_shop_field_escalation trigger rejecting the plan
    // change (run migrations/phase10_subscription_backend_update.sql).
    console.error("[confirm-subscription] shop update failed:", updErr.message);
    return NextResponse.json({ error: `Could not apply plan: ${updErr.message}` }, { status: 500 });
  }

  // Cancel the previous subscription on an upgrade so they aren't double-billed.
  if (oldSubId && oldSubId !== newSubId) {
    await stripe.subscriptions.cancel(oldSubId).catch(() => null);
  }

  // Welcome / confirmation email to the shop owner (best-effort).
  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const { data: planRow } = planId
    ? await supabaseAdmin.from("plans").select("name").eq("id", planId).maybeSingle()
    : { data: null as { name: string } | null };
  const ownerEmail = user.email || shop.email;
  if (ownerEmail) {
    fetch(`${baseUrl}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "subscription_started",
        data: { shopName: shop.name, ownerEmail, planName: planRow?.name ?? planId ?? "your new plan" },
      }),
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, paid: true, plan: planId });
}
