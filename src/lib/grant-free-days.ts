import { supabaseAdmin } from "@/lib/supabase-admin";

// Grant N free days of a paid plan by extending a shop's no-card trial window —
// the same engine as the 21-day signup trial, so it bypasses payment. Shared by
// the admin one-tap comp and the customer coupon-redeem flow. Server-only.

const RANK: Record<string, number> = { starter: 0, pro: 1, premium: 2, business: 3 };
const rank = (p: string | null | undefined) => RANK[(p ?? "starter").toLowerCase()] ?? 0;
const PAID = new Set(["pro", "premium", "business"]);

export type GrantResult =
  | { ok: true; plan: string; trialEndsAt: string }
  | { ok: false; error: string; code?: "paid_sub" | "not_found" | "bad_input" };

export async function grantFreeDays(shopId: string, plan: string, days: number): Promise<GrantResult> {
  const d = Math.round(Number(days));
  if (!Number.isFinite(d) || d <= 0 || d > 365) return { ok: false, error: "Days must be between 1 and 365.", code: "bad_input" };
  const wantPlan = (plan ?? "pro").toLowerCase();
  if (!PAID.has(wantPlan)) return { ok: false, error: "Free days apply to a paid plan (Pro/Premium).", code: "bad_input" };

  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("id, subscription_plan, subscription_status, trial_ends_at, stripe_subscription_id, status")
    .eq("id", shopId).maybeSingle();
  if (!shop) return { ok: false, error: "Shop not found.", code: "not_found" };
  // A live card subscription needs a Stripe credit, not a trial extension — out of scope.
  if (shop.stripe_subscription_id) {
    return { ok: false, error: "This shop is on a paid card subscription — free days only apply to free/trial shops.", code: "paid_sub" };
  }

  // Extend from the LATER of now / their current trial end, so days always add on.
  const existing = shop.trial_ends_at ? new Date(shop.trial_ends_at).getTime() : 0;
  const base = Math.max(Date.now(), Number.isNaN(existing) ? 0 : existing);
  const trialEndsAt = new Date(base + d * 86_400_000).toISOString();

  // Never downgrade a higher plan (e.g. a Pro coupon on a Premium trial keeps Premium).
  const newPlan = rank(shop.subscription_plan) > rank(wantPlan) ? String(shop.subscription_plan) : wantPlan;

  const upd: Record<string, unknown> = {
    subscription_plan: newPlan,
    subscription_status: "active",
    trial_ends_at: trialEndsAt,
  };
  // Make it usable immediately, but never reactivate a suspended/rejected shop.
  if (shop.status !== "suspended" && shop.status !== "rejected") upd.status = "approved";

  let r = await supabaseAdmin.from("shops").update(upd).eq("id", shopId).select("id").single();
  // Resilient to the trial_ends_at column not existing yet (phase34).
  if (r.error && /trial_ends_at/.test(r.error.message) && /column|does not exist|schema cache/i.test(r.error.message)) {
    const { trial_ends_at: _t, ...noTrial } = upd;
    r = await supabaseAdmin.from("shops").update(noTrial).eq("id", shopId).select("id").single();
  }
  if (r.error) return { ok: false, error: "Couldn't apply the free days. Please try again." };
  return { ok: true, plan: newPlan, trialEndsAt };
}
