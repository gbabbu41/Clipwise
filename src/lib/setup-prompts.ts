import { effectivePlan, planHasFeature } from "@/lib/validation";

type SetupShop = {
  subscription_plan?: string;
  subscription_status?: string;
  trial_ends_at?: string | null;
  stripe_subscription_id?: string | null;
};

/** Presentation only: never nudge an expired no-card trial to connect payments
 * while the daily downgrade job catches up. Feature entitlements stay unchanged. */
export function canPromptPaymentSetup(shop: SetupShop | null | undefined, now = Date.now()): boolean {
  if (!shop) return false;
  if (!shop.stripe_subscription_id && shop.trial_ends_at) {
    const end = Date.parse(shop.trial_ends_at);
    if (!Number.isFinite(end) || end <= now) return false;
  }
  return planHasFeature(effectivePlan(shop.subscription_plan, shop.subscription_status), "payments");
}
