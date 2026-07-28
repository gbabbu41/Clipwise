import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify";
import { sendAppEmail } from "@/lib/emailer";

// Days-out at which we nudge a trialing shop to add a card (escalating tone).
const REMIND_DAYS = new Set([7, 3, 1]);
const planName = (p?: string | null) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : "Pro");

/**
 * Daily trial lifecycle — runs inside the existing daily cron (no extra Vercel
 * cron, so it can't trip the Hobby-plan cron limit). A "trial" is a shop with
 * trial_ends_at set, subscription_status 'active', and NO stripe_subscription_id.
 *
 *  · 7 / 3 / 1 days out → remind the owner (in-app + email) to add a card.
 *  · expired (trial_ends_at passed, still no card) → downgrade to the free
 *    Starter plan (subscription_status 'inactive', trial_ends_at cleared) so plan
 *    gating drops the paid features, and notify the owner.
 *
 * Idempotent by construction: the reminder thresholds hit once each on a daily
 * cadence, and downgrade clears trial_ends_at so a shop is processed once.
 */
export async function processTrials(nowMs: number): Promise<{ reminded: number; expired: number; scanned: number }> {
  const { data: shops } = await supabaseAdmin
    .from("shops")
    .select("id, name, email, owner_id, subscription_plan, trial_ends_at")
    .not("trial_ends_at", "is", null)
    .is("stripe_subscription_id", null)
    .eq("subscription_status", "active");

  let reminded = 0;
  let expired = 0;

  for (const shop of shops ?? []) {
    const endMs = new Date(shop.trial_ends_at as string).getTime();
    if (Number.isNaN(endMs)) continue;
    const daysLeft = Math.ceil((endMs - nowMs) / 86_400_000);
    const plan = planName(shop.subscription_plan);
    const shopName = shop.name ?? "your shop";

    if (daysLeft <= 0) {
      // Trial expired with no card → downgrade to Starter. The extra guards keep
      // us from racing a shop that just subscribed between the SELECT and here.
      await supabaseAdmin.from("shops")
        .update({ subscription_status: "inactive", trial_ends_at: null })
        .eq("id", shop.id).eq("subscription_status", "active").is("stripe_subscription_id", null)
        .then(null, () => null);
      if (shop.owner_id) {
        await insertNotifications({
          user_id: shop.owner_id, shop_id: shop.id,
          title: "Your free trial ended",
          message: `Your ${plan} trial is over — ${shopName} is now on the free Starter plan. Add a card in Billing to switch your paid features back on.`,
          type: "system",
        });
      }
      if (shop.email) {
        await sendAppEmail("trial_ended", { ownerEmail: shop.email, shopName, planName: plan }).then(null, () => null);
      }
      expired++;
    } else if (REMIND_DAYS.has(daysLeft)) {
      const label = daysLeft === 1 ? "1 day" : `${daysLeft} days`;
      if (shop.owner_id) {
        await insertNotifications({
          user_id: shop.owner_id, shop_id: shop.id,
          title: daysLeft <= 1 ? "⚠️ Trial ends tomorrow — add a card" : `Your free trial ends in ${label}`,
          message: `Add a card to keep ${shopName}'s paid features (online payments, POS, loyalty, extra barbers) after your ${plan} trial ends.`,
          type: "system",
        });
      }
      if (shop.email) {
        await sendAppEmail("trial_reminder", { ownerEmail: shop.email, shopName, planName: plan, daysLeft: label }).then(null, () => null);
      }
      reminded++;
    }
  }

  return { reminded, expired, scanned: (shops ?? []).length };
}
