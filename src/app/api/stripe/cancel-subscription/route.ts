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

  const { immediate = false } = await request.json().catch(() => ({})) as { immediate?: boolean };

  const { data: shops } = await supabaseAdmin
    .from("shops").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1);
  const shop = shops?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  const onTrial = !!shop.trial_ends_at && !shop.stripe_subscription_id;
  const hasPaidSub = !!shop.stripe_subscription_id;
  if (!hasPaidSub && !onTrial) {
    return NextResponse.json({ error: "You're already on the free plan — nothing to cancel." }, { status: 400 });
  }

  try {
    // ── Immediate: drop to free now ──────────────────────────────────────────
    if (immediate) {
      if (hasPaidSub) {
        await stripe.subscriptions.cancel(shop.stripe_subscription_id).catch(() => null);
      }
      await supabaseAdmin.from("shops")
        .update({ subscription_status: "inactive", subscription_plan: "starter", trial_ends_at: null })
        .eq("id", shop.id);
      return NextResponse.json({ ok: true, immediate: true });
    }

    // ── Trial (no card): keep it until it ends — just report the date ─────────
    if (onTrial) {
      return NextResponse.json({ ok: true, trial: true, endsAt: shop.trial_ends_at });
    }

    // ── Paid: cancel at period end (keep access until then) ───────────────────
    const sub = await stripe.subscriptions.update(shop.stripe_subscription_id, { cancel_at_period_end: true }) as unknown as Stripe.Subscription & { current_period_end?: number };
    const periodEnd = (sub.items?.data?.[0] as { current_period_end?: number } | undefined)?.current_period_end ?? sub.current_period_end;
    return NextResponse.json({
      ok: true,
      scheduled: true,
      endsAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't cancel — please try again." }, { status: 500 });
  }
}
