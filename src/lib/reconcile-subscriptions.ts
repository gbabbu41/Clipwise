// Server-only — daily safety-net for a MISSED Stripe subscription webhook.
//
// Normally customer.subscription.deleted/updated keeps our DB in sync. If that
// one event is ever missed, a cancelled/unpaid shop would keep its premium
// features forever (or a recovered shop stay locked). Once a day this re-checks
// each paid subscription's LIVE status in Stripe and corrects the DB.
//
// CONSERVATIVE BY DESIGN — it must never strip a paying shop of its plan:
//   • It only ACTS on a definitive Stripe status.
//   • It only downgrades when Stripe says the sub is genuinely dead, OR Stripe
//     returns a real "no such subscription" (404/resource_missing).
//   • On ANY other error (network, rate limit, ambiguity) it SKIPS that sub and
//     leaves the DB untouched.
// Locations share one subscription, so we hit Stripe once per subscription id
// and fan the result out to every shop on it.
import { stripe } from "./stripe";
import { supabaseAdmin } from "./supabase-admin";

export async function reconcileSubscriptions(): Promise<{ checked: number; downgraded: number; corrected: number }> {
  const { data: rows } = await supabaseAdmin
    .from("shops")
    .select("id, stripe_subscription_id, subscription_status")
    .not("stripe_subscription_id", "is", null);
  if (!rows?.length) return { checked: 0, downgraded: 0, corrected: 0 };

  // subId -> [shopId, …]
  const bySub = new Map<string, string[]>();
  for (const r of rows) {
    const sid = r.stripe_subscription_id as string | null;
    if (!sid) continue;
    (bySub.get(sid) ?? bySub.set(sid, []).get(sid)!).push(r.id);
  }

  let downgraded = 0;
  let corrected = 0;
  const DEAD = new Set(["canceled", "incomplete_expired"]);

  const markCancelled = async (shopIds: string[]) => {
    const { error } = await supabaseAdmin.from("shops")
      .update({ subscription_status: "cancelled", subscription_plan: "starter" })
      .in("id", shopIds)
      .neq("subscription_status", "cancelled");
    if (!error) downgraded += shopIds.length;
  };

  for (const [subId, shopIds] of Array.from(bySub.entries())) {
    let status: string | null = null;
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      status = sub.status;
    } catch (err) {
      const e = err as { code?: string; statusCode?: number; raw?: { code?: string; statusCode?: number } };
      const missing =
        e.code === "resource_missing" || e.raw?.code === "resource_missing" ||
        e.statusCode === 404 || e.raw?.statusCode === 404;
      // Only a definitive "it's gone" downgrades; every other error is skipped so
      // a Stripe hiccup can never wrongly strip a paying shop of its plan.
      if (missing) await markCancelled(shopIds);
      continue;
    }

    if (DEAD.has(status)) {
      await markCancelled(shopIds);
    } else if (status === "past_due" || status === "unpaid") {
      const { error } = await supabaseAdmin.from("shops")
        .update({ subscription_status: "past_due" })
        .in("id", shopIds)
        .neq("subscription_status", "past_due");
      if (!error) corrected += shopIds.length;
    } else if (status === "active" || status === "trialing") {
      // Self-heal a shop that a missed event left flagged past_due but that has
      // since recovered. (We don't resurrect a cancelled row here — restoring the
      // right plan needs the sub's price; that's out of this safety-net's scope.)
      const { error } = await supabaseAdmin.from("shops")
        .update({ subscription_status: "active" })
        .in("id", shopIds)
        .eq("subscription_status", "past_due");
      if (!error) corrected += shopIds.length;
    }
    // Any other status (incomplete, paused, …) → leave as-is (uncertain).
  }

  return { checked: bySub.size, downgraded, corrected };
}
