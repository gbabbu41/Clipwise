import { supabaseAdmin } from "@/lib/supabase-admin";
import { planHasFeature } from "@/lib/validation";

// Shared, SERVER-AUTHORITATIVE loyalty redemption used by both customer booking
// paths (online checkout + in-person/free). The browser only ever sends a
// boolean "use my points" intent — never an amount. This file owns the math and
// the point deduction so a customer can't forge a bigger discount.

// A customer must have at least this much VALUE in points before they can redeem
// (owner-requested rule — stops trivial 1-point redemptions).
export const MIN_REDEEM_DOLLARS = 5;

type LoyaltyCfg = { enabled?: boolean; redemption_rate?: number } | null | undefined;

function loyaltyCfg(bookingSettings: unknown): LoyaltyCfg {
  return (bookingSettings as { loyalty?: LoyaltyCfg } | null)?.loyalty ?? null;
}

/** The client (by email → phone) and their current points balance for a shop. */
async function findBalance(shopId: string, email?: string | null, phone?: string | null): Promise<{ id: string; points: number } | null> {
  const e = (email ?? "").trim();
  const p = (phone ?? "").trim();
  if (e) {
    const { data } = await supabaseAdmin.from("clients").select("id, loyalty_points").eq("shop_id", shopId).ilike("email", e).maybeSingle();
    if (data) return { id: data.id, points: Math.max(0, Number(data.loyalty_points ?? 0)) };
  }
  if (p) {
    const { data } = await supabaseAdmin.from("clients").select("id, loyalty_points").eq("shop_id", shopId).eq("phone", p).maybeSingle();
    if (data) return { id: data.id, points: Math.max(0, Number(data.loyalty_points ?? 0)) };
  }
  return null;
}

/** Dollar value of a points balance under a shop's redemption rate (100 pts = $rate). */
export function pointsValue(points: number, redemptionRate: number): number {
  return Math.round((Math.max(0, points) / 100) * redemptionRate * 100) / 100;
}

/**
 * What a returning customer MAY see/redeem at booking — used by the public
 * lookup endpoint. Returns eligibility only when loyalty is on-plan + enabled
 * for the shop and the balance is worth at least $MIN_REDEEM_DOLLARS.
 */
export async function lookupRedeemable(opts: {
  shopId: string; plan: string; bookingSettings: unknown; email?: string | null; phone?: string | null;
}): Promise<{ eligible: boolean; points: number; value: number }> {
  const ls = loyaltyCfg(opts.bookingSettings);
  if (!planHasFeature(opts.plan, "loyalty") || ls?.enabled === false) return { eligible: false, points: 0, value: 0 };
  const rate = Number(ls?.redemption_rate ?? 5);
  if (!(rate > 0)) return { eligible: false, points: 0, value: 0 };
  const bal = await findBalance(opts.shopId, opts.email, opts.phone);
  const points = bal?.points ?? 0;
  const value = pointsValue(points, rate);
  return { eligible: value >= MIN_REDEEM_DOLLARS, points, value };
}

/**
 * How much a customer may actually redeem against THIS booking. Returns the
 * points to deduct + the dollar discount (capped at the pre-tax total). 0/0 when
 * not requested or not eligible. NEVER trusts a client-sent amount.
 */
export async function computeRedemption(opts: {
  shopId: string; plan: string; bookingSettings: unknown;
  email?: string | null; phone?: string | null;
  preTaxTotal: number;   // effective service total AFTER any promo, pre-tax
  requested: boolean;    // customer toggled "use my points"
}): Promise<{ points: number; discount: number }> {
  if (!opts.requested || opts.preTaxTotal <= 0) return { points: 0, discount: 0 };
  const ls = loyaltyCfg(opts.bookingSettings);
  if (!planHasFeature(opts.plan, "loyalty") || ls?.enabled === false) return { points: 0, discount: 0 };
  const rate = Number(ls?.redemption_rate ?? 5);
  if (!(rate > 0)) return { points: 0, discount: 0 };

  const bal = await findBalance(opts.shopId, opts.email, opts.phone);
  if (!bal) return { points: 0, discount: 0 };
  const value = pointsValue(bal.points, rate);
  if (value < MIN_REDEEM_DOLLARS) return { points: 0, discount: 0 };

  const discount = Math.round(Math.min(value, opts.preTaxTotal) * 100) / 100;
  const points = Math.min(bal.points, Math.round((discount / rate) * 100));
  return { points, discount };
}

/**
 * Deduct the points that back a POS / in-person loyalty discount of $N. Converts
 * the dollar discount to points at the shop's rate and deducts them, capped at the
 * client's REAL balance (deductRedeemedPoints never drives it negative). Used by
 * the POS sale routes, where the staff applies the discount and we settle the
 * points server-side. Best-effort — a points hiccup never fails a real sale.
 */
export async function redeemPointsForDiscount(opts: {
  shopId: string; email?: string | null; phone?: string | null;
  discountDollars: number; bookingSettings: unknown;
}): Promise<void> {
  if (!(opts.discountDollars > 0)) return;
  const ls = loyaltyCfg(opts.bookingSettings);
  if (ls?.enabled === false) return;
  const rate = Number(ls?.redemption_rate ?? 5);
  if (!(rate > 0)) return;
  const points = Math.round((opts.discountDollars / rate) * 100);
  await deductRedeemedPoints({ shopId: opts.shopId, email: opts.email, phone: opts.phone, points });
}

/**
 * Deduct redeemed points once the booking exists + logs the redemption. Deducts
 * min(balance, points) so it can never drive a balance negative. Best-effort:
 * a logging failure must never roll back a real booking. Idempotency is the
 * caller's (both booking paths de-dupe the appointment before calling this).
 */
export async function deductRedeemedPoints(opts: {
  shopId: string; email?: string | null; phone?: string | null; points: number; appointmentId?: string | null;
}): Promise<void> {
  if (!opts.points || opts.points <= 0) return;
  const bal = await findBalance(opts.shopId, opts.email, opts.phone);
  if (!bal) return;
  const used = Math.min(bal.points, opts.points);
  if (used <= 0) return;
  await supabaseAdmin.from("clients").update({ loyalty_points: Math.max(0, bal.points - used) }).eq("id", bal.id);
  await supabaseAdmin.from("loyalty_rewards")
    .insert({ shop_id: opts.shopId, client_id: bal.id, points: -used, action: "redeemed" })
    .then(null, () => null);
}
