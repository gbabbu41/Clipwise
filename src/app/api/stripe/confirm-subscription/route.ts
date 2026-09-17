import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { getLocationLimit } from "@/lib/validation";
import { reconcileLocationAddon, reconcileAiPhoneAddon } from "@/lib/stripe-addons";
import { cancelDuplicateSubscriptions } from "@/lib/stripe-subscription";
import { isNativeRequest } from "@/lib/native-app";
import { sendAppEmail } from "@/lib/emailer";

// Called by the Billing page when the owner returns from a subscription
// Checkout (upgrade/switch). Verifies the session and applies the plan to the
// owner's shop synchronously — so it works even when the platform webhook isn't
// wired to receive subscription events. Idempotent (safe to call twice).
export async function POST(request: NextRequest) {
  // Apple IAP: no subscription checkout can be started in the app, so there's
  // nothing to confirm here either — refuse.
  if (isNativeRequest(request)) {
    return NextResponse.json({ error: "Not available in the app." }, { status: 403 });
  }
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { session_id } = body as { session_id?: string };
  if (typeof session_id !== "string" || !session_id || session_id.length > 255) return NextResponse.json({ error: "Missing or invalid session_id" }, { status: 400 });

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
  const paid = session.status === "complete" && (session.payment_status === "paid" || session.payment_status === "no_payment_required");
  if (session.mode !== "subscription" || !paid) {
    return NextResponse.json({ ok: false, paid: false });
  }

  const newSubId = typeof session.subscription === "string" ? session.subscription : null;
  const customerId = typeof session.customer === "string" ? session.customer : null;
  const oldSubId = meta.old_subscription_id || "";
  if (!newSubId || !customerId) return NextResponse.json({ error: "Could not verify subscription." }, { status: 409 });

  // A completed Checkout URL is a historical receipt, not proof of CURRENT
  // entitlement. Reopening it after cancellation or a plan change must never
  // revive the old plan or cancel the owner's newer subscription.
  let currentSub: Awaited<ReturnType<typeof stripe.subscriptions.retrieve>>;
  try {
    currentSub = await stripe.subscriptions.retrieve(newSubId);
  } catch {
    return NextResponse.json({ error: "Couldn't verify your current subscription. Please refresh Billing." }, { status: 502 });
  }
  const subCustomer = typeof currentSub.customer === "string" ? currentSub.customer : currentSub.customer?.id;
  if (currentSub.metadata?.user_id !== user.id || subCustomer !== customerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!["active", "trialing"].includes(currentSub.status) || !currentSub.metadata?.plan) {
    return NextResponse.json({ error: "This checkout no longer has an active subscription. Refresh Billing to see your current plan." }, { status: 409 });
  }
  const planId = currentSub.metadata.plan;

  const { data: shops, error: shopsError } = await supabaseAdmin
    .from("shops").select("id, name, email, subscription_plan, subscription_status, stripe_subscription_id")
    .eq("owner_id", user.id).order("created_at", { ascending: false });
  if (shopsError) return NextResponse.json({ error: "Couldn't check your account. Please try again." }, { status: 503 });
  const shop = shops?.[0];
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  const alreadyApplied = shops.every(s => s.stripe_subscription_id === newSubId && s.subscription_plan === planId && s.subscription_status === "active");

  const otherIds = Array.from(new Set((shops ?? []).map(s => s.stripe_subscription_id).filter((id): id is string => !!id && id !== newSubId)));
  for (const id of otherIds) {
    if (id === oldSubId) continue; // explicit replacement captured by our checkout
    try {
      const other = await stripe.subscriptions.retrieve(id);
      if (!["canceled", "incomplete_expired"].includes(other.status)) {
        return NextResponse.json({ error: "A different subscription is already attached to your account. Refresh Billing before continuing." }, { status: 409 });
      }
    } catch {
      return NextResponse.json({ error: "Couldn't verify your existing subscription. Please refresh Billing." }, { status: 502 });
    }
  }

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

  // Cancel EVERY other active subscription on this customer (plus the captured
  // old-sub id) so an upgrade never double-bills — shared with the webhook path.
  await cancelDuplicateSubscriptions(customerId, newSubId, oldSubId);

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
  const { data: planRow } = planId
    ? await supabaseAdmin.from("plans").select("name").eq("id", planId).maybeSingle()
    : { data: null as { name: string } | null };
  const ownerEmail = user.email || shop.email;
  if (ownerEmail && !alreadyApplied) {
    await sendAppEmail("subscription_started", {
      shopName: shop.name, ownerEmail, planName: planRow?.name ?? planId ?? "your new plan",
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, paid: true, plan: planId });
}
