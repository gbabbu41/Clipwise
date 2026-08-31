import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

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
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { immediate = false, shop_id } = await request.json().catch(() => ({})) as { immediate?: boolean; shop_id?: string };

  // Scope to the shop the owner is VIEWING (billing is per-active-shop) so a
  // multi-location owner cancels the right one — not always the newest. Still
  // constrained to shops they own, so a bad shop_id can't touch another account.
  let shopQ = supabaseAdmin.from("shops").select("*").eq("owner_id", user.id);
  shopQ = shop_id ? shopQ.eq("id", shop_id) : shopQ.order("created_at", { ascending: false });
  const { data: shops } = await shopQ.limit(1);
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
      const { error: upErr } = await supabaseAdmin.from("shops")
        .update({
          subscription_status: "inactive", subscription_plan: "starter", trial_ends_at: null, stripe_subscription_id: null,
          // If this cancel ended a running trial, record when — permanent history
          // (trial_ends_at is cleared because a set value reads as "on trial").
          ...(shop.trial_ends_at ? { trial_ended_at: new Date().toISOString() } : {}),
        })
        .eq("id", shop.id);
      if (upErr) {
        console.error("[cancel-subscription] immediate downgrade write failed", upErr);
        return NextResponse.json({ error: "Cancelled with Stripe but couldn't update your account — please contact support." }, { status: 500 });
      }
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
    const { error: compErr } = await supabaseAdmin.from("shops")
      .update({ subscription_status: "inactive", subscription_plan: "starter", trial_ends_at: null })
      .eq("id", shop.id);
    if (compErr) {
      console.error("[cancel-subscription] comped downgrade write failed", compErr);
      return NextResponse.json({ error: "Couldn't update your account — please try again." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, immediate: true });
  } catch (err) {
    // Generic message to the client; real detail stays in the server logs.
    console.error("[cancel-subscription] error", err);
    return NextResponse.json({ error: "Couldn't cancel — please try again." }, { status: 500 });
  }
}
