import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isNativeRequest } from "@/lib/native-app";

// Cancel / downgrade-to-free.
//
// Default (immediate=false): they KEEP what they paid for.
//   • Paid subscription → schedule cancel at period end (Stripe keeps it active
//     until then; the customer.subscription.deleted webhook flips us to Starter
//     when it actually ends). No refund for unused days.
//   • No-card trial → nothing to cancel (no charge is coming); it already reverts
//     to Starter at trial_ends_at. We just report the end date.
//
// immediate=true ("switch to free now"): drop to Starter right away — cancel the
// Stripe sub now (paid) or clear the trial (trial), and set plan=starter.
export async function POST(request: NextRequest) {
  // Apple IAP: subscription management lives on clipwise.ca, not in the app.
  if (isNativeRequest(request)) {
    return NextResponse.json({ error: "Not available in the app." }, { status: 403 });
  }
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)
    || (body.immediate !== undefined && typeof body.immediate !== "boolean")
    || (body.shop_id !== undefined && (typeof body.shop_id !== "string" || !body.shop_id || body.shop_id.length > 100))) {
    return NextResponse.json({ error: "Invalid cancellation request." }, { status: 400 });
  }
  const { immediate = false, shop_id } = body as { immediate?: boolean; shop_id?: string };

  // The selected shop identifies the owner's shared subscription. Mutations
  // must cover every location still attached to that subscription, not just it.
  let shopQ = supabaseAdmin.from("shops").select("id, subscription_plan, subscription_status, trial_ends_at, stripe_subscription_id").eq("owner_id", user.id);
  shopQ = shop_id ? shopQ.eq("id", shop_id) : shopQ.order("created_at", { ascending: false });
  const { data: shops, error: readError } = await shopQ.limit(1);
  if (readError) return NextResponse.json({ error: "Couldn't check your subscription. Please try again." }, { status: 503 });
  const shop = shops?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  const onTrial = !!shop.trial_ends_at && !shop.stripe_subscription_id;
  const hasPaidSub = !!shop.stripe_subscription_id;
  const planOnRecord = (shop.subscription_plan ?? "starter");
  if (planOnRecord === "starter" && !hasPaidSub && !onTrial) {
    return NextResponse.json({ error: "You're already on the free plan — nothing to cancel." }, { status: 400 });
  }

  try {
    // ── Immediate: drop to free now ──────────────────────────────────────────
    if (immediate) {
      if (hasPaidSub) {
        // Do NOT swallow this — if Stripe doesn't actually cancel, we must not
        // tell the owner they're on free while their card keeps getting charged.
        try {
          await stripe.subscriptions.cancel(shop.stripe_subscription_id);
        } catch (err) {
          console.error("[cancel-subscription] Stripe cancel failed", err);
          return NextResponse.json({ error: "Couldn't cancel your subscription with Stripe — please try again." }, { status: 502 });
        }
      }
      // Clear the (now dead) subscription id so a re-subscribe / start-trial isn't
      // blocked by a stale id, and a stray future event can't map back to this row.
      // Keep stripe_customer_id so a re-subscribe reuses the same Stripe customer.
      let downgrade = supabaseAdmin.from("shops")
        .update({
          subscription_status: "inactive", subscription_plan: "starter", trial_ends_at: null, stripe_subscription_id: null,
          // If this cancel ended a running trial, record when — permanent history
          // (trial_ends_at is cleared because a set value reads as "on trial").
          ...(shop.trial_ends_at ? { trial_ended_at: new Date().toISOString() } : {}),
        })
        .eq("owner_id", user.id);
      if (hasPaidSub) downgrade = downgrade.eq("stripe_subscription_id", shop.stripe_subscription_id);
      else {
        downgrade = downgrade.is("stripe_subscription_id", null)
          .eq("subscription_plan", planOnRecord).eq("subscription_status", shop.subscription_status);
        // Included locations inherit the same trial clock. End that shared trial
        // together, but never overwrite a location activated by paid checkout.
        downgrade = onTrial ? downgrade.eq("trial_ends_at", shop.trial_ends_at)
          : downgrade.eq("id", shop.id).is("trial_ends_at", null);
      }
      // A concurrent checkout must not be overwritten with Starter.
      const { error: upErr, data: updated } = await downgrade.select("id");
      if (upErr) {
        console.error("[cancel-subscription] immediate downgrade write failed", upErr);
        return NextResponse.json({ error: "Cancelled with Stripe but couldn't update your account — please contact support." }, { status: 500 });
      }
      if (!updated?.length && !hasPaidSub) return NextResponse.json({ error: "Your subscription changed. Refresh Billing before trying again." }, { status: 409 });
      return NextResponse.json({ ok: true, immediate: true });
    }

    // ── Trial (no card): keep it until it ends — just report the date ─────────
    if (onTrial) {
      return NextResponse.json({ ok: true, trial: true, endsAt: shop.trial_ends_at });
    }

    // ── Paid: cancel at period end (keep access until then) ───────────────────
    if (hasPaidSub) {
      const sub = await stripe.subscriptions.update(shop.stripe_subscription_id, { cancel_at_period_end: true }) as unknown as Stripe.Subscription & { current_period_end?: number };
      const periodEnd = (sub.items?.data?.[0] as { current_period_end?: number } | undefined)?.current_period_end ?? sub.current_period_end;
      return NextResponse.json({
        ok: true,
        scheduled: true,
        endsAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      });
    }

    // ── Admin-comped plan (active, no Stripe sub, no trial clock): nothing to
    //    "keep until", so just move them to the free Starter plan now. ─────────
    const { error: compErr, data: compRows } = await supabaseAdmin.from("shops")
      .update({ subscription_status: "inactive", subscription_plan: "starter", trial_ends_at: null })
      .eq("id", shop.id).eq("owner_id", user.id).is("stripe_subscription_id", null)
      .eq("subscription_plan", planOnRecord).eq("subscription_status", shop.subscription_status)
      .is("trial_ends_at", null).select("id");
    if (compErr) {
      console.error("[cancel-subscription] comped downgrade write failed", compErr);
      return NextResponse.json({ error: "Couldn't update your account — please try again." }, { status: 500 });
    }
    if (!compRows?.length) return NextResponse.json({ error: "Your subscription changed. Refresh Billing before trying again." }, { status: 409 });
    return NextResponse.json({ ok: true, immediate: true });
  } catch (err) {
    // Generic message to the client; real detail stays in the server logs.
    console.error("[cancel-subscription] error", err);
    return NextResponse.json({ error: "Couldn't cancel — please try again." }, { status: 500 });
  }
}
