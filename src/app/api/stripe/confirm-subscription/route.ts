import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { getLocationLimit } from "@/lib/validation";
import { reconcileLocationAddon, reconcileAiPhoneAddon } from "@/lib/stripe-addons";

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
  // The session MUST belong to this user (our checkout always stamps user_id).
  // Treat a missing user_id as forbidden too — don't attach an unlabeled
  // session's subscription/customer to whoever calls this.
  if (!meta.user_id || meta.user_id !== user.id) {
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

  // Apply to ALL of the owner's shops — they share ONE subscription. (Was only
  // the newest shop, which left a multi-location owner's other shops pointing at
  // the old, now-cancelled subscription id + old plan.)
  const subUpdate = {
    subscription_status: "active",
    stripe_subscription_id: newSubId,
    stripe_customer_id: customerId,
    trial_ends_at: null,   // they've added a card — no longer a trial
    ...(planId ? { subscription_plan: planId } : {}),
  };
  let { error: updErr } = await supabaseAdmin.from("shops").update(subUpdate).eq("owner_id", user.id);
  // Resilient to the phase34 migration not being run yet — retry without trial_ends_at.
  if (updErr && /trial_ends_at/.test(updErr.message) && /column|does not exist|schema cache/i.test(updErr.message)) {
    const { trial_ends_at: _t, ...noTrial } = subUpdate;
    ({ error: updErr } = await supabaseAdmin.from("shops").update(noTrial).eq("owner_id", user.id));
  }
  if (updErr) {
    // Most likely the prevent_shop_field_escalation trigger rejecting the plan
    // change (run migrations/phase10_subscription_backend_update.sql).
    console.error("[confirm-subscription] shop update failed:", updErr.message);
    return NextResponse.json({ error: "Payment received, but we couldn't activate the plan. Please refresh in a moment." }, { status: 500 });
  }

  // Cancel EVERY other active subscription on this customer — not just the one we
  // captured at checkout time. Two checkouts (two tabs / back button) could each
  // create a subscription and leave the first one billing forever; this sweeps up
  // any such ghost. Safe because add-ons are line items on the ONE subscription,
  // never separate subscriptions, so the only "other" active sub is a duplicate.
  if (customerId && newSubId) {
    try {
      const others = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 100 });
      for (const s of others.data) {
        if (s.id !== newSubId) await stripe.subscriptions.cancel(s.id).catch(() => null);
      }
    } catch { /* non-fatal — the captured old-sub fallback below still runs */ }
  }
  if (oldSubId && oldSubId !== newSubId) {
    await stripe.subscriptions.cancel(oldSubId).catch(() => null);
  }

  // Re-attach the $30/location add-on onto the NEW subscription: a plan change
  // creates a fresh subscription, so the add-on item doesn't carry over. Recompute
  // it from the owner's real location count so 3rd+ locations keep being billed.
  const effPlan = planId ?? shop.subscription_plan ?? undefined;
  if (newSubId && effPlan) {
    await ensurePlansHydrated();
    const { count } = await supabaseAdmin.from("shops").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
    const included = getLocationLimit(effPlan);
    await reconcileLocationAddon(newSubId, Math.max(0, (count ?? 0) - included)).catch(() => {});
    // Re-attach the $15/mo AI-phone add-on too (a plan change makes a fresh sub,
    // dropping it) if any of the owner's shops still has the phone active —
    // otherwise they keep the feature but stop paying for it.
    const { data: aiRow } = await supabaseAdmin
      .from("shops").select("id").eq("owner_id", user.id).eq("ai_phone_plan_active", true).limit(1).maybeSingle();
    if (aiRow) await reconcileAiPhoneAddon(newSubId, true).catch(() => {});
  }

  // Welcome / confirmation email to the shop owner (best-effort).
  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
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
