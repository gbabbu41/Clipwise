// Shared barber-earnings math — the ONE definition of "what a barber earned",
// used by BOTH the barber's own portal (/api/barber/earnings) and the owner's
// Payments page when it's filtered to a single barber. Filtering Payments by a
// barber must show EXACTLY what that barber sees in their own portal, so both
// screens compute from the same rows (that barber's `transactions`) with the
// same formula here. If this changes, both screens change together.
//
// Card-fee handling: the SHOP bears the ENTIRE Stripe card fee. A barber's
// take-home is never reduced by it (barberFeeShare is always 0); the shop's
// "keeps" absorbs the whole fee. (Changed from the old 50/50 split — the owner
// decided the shop covers processing entirely.)
//
// Owner's OWN chair: an owner who cuts hair isn't in a commission relationship
// with themselves — they OWN the shop, so they keep 100% of the service they
// perform (it's simultaneously their barber income and the shop's profit, one
// pocket). So the owner's chair is stored at commission_percent = 0 — which is
// what the SHOP-aggregate dashboard/analytics read, so their own cuts count as
// $0 commission expense and stay in shop profit (not booked as a payout). The
// PER-BARBER earnings views (this file's consumers) pass isOwner=true to flip
// the take-home to the full 100% the owner actually keeps. Two lenses, one truth.

export type EarningTx = {
  amount: number;                    // service amount (pre-tip); NEGATIVE on a refund row
  tip?: number | null;               // 100% the barber's; negative on a refund row
  commission_amount?: number | null; // stored cut; falls back to amount × pct
  stripe_fee?: number | null;        // real card fee on this charge (0 for cash)
  refunded?: boolean | null;
  source?: string | null;            // "refund" = money handed back (see below)
  service_name?: string | null;
  payment_method?: string | null;
};

// REFUNDS (owner rule 2026-10-03 — commission take-back): a refunded sale keeps
// its cut on the day it was paid, and its refund row (source "refund", negative
// amounts, same barber) takes the cut + tip back on the day of the refund. So a
// barber's past pay periods never change after the fact, and a refund after
// payday shows up as a deduction in the period it happened — not silently lost.
export const isRefundTx = (t: { source?: string | null }) => t.source === "refund";
// NO-SHOWS (owner decision 2026-10-03 — "split everything"): any money a customer
// paid is split at the barber's %, and only a refund takes it back. That covers a
// visit paid in advance that no-showed AND a no-show fee charged to a held card —
// the barber blocked that time either way. So every line of the barber's ledger
// counts (a gift-card visit's line too — phase76; never shop money, lib/revenue).

/** Commission taken BACK by a refund row (a positive number to subtract). Same rule
 *  as the sale's cut: the stored cut when sane, else amount × pct; the owner's own
 *  chair takes back 100%. */
export function refundClawback(t: { amount: number | null; commission_amount?: number | null; service_name?: string | null; source?: string | null }, pct: number, isOwner = false): number {
  if (!isRefundTx(t)) return 0;
  const amt = Math.abs(t.amount ?? 0);
  if (isOwner) return amt;
  const stored = t.commission_amount == null ? null : Math.abs(t.commission_amount);
  return safeCommission(amt, stored, pct);
}

export type BarberEarnings = {
  revenue: number;        // service + tips the barber generated
  serviceAmount: number;  // service only (pre-tip)
  commission: number;     // the barber's service cut (their %)
  tips: number;           // 100% the barber's
  stripeFee: number;      // total card fee across these txs (borne by the shop)
  barberFeeShare: number; // always 0 — the shop bears the whole card fee
  youKeep: number;        // TAKE-HOME = commission + tips (no fee deducted)
  shopKeeps: number;      // service − commission − full stripe fee
  count: number;
  avgTicket: number;
};

// A stored commission cut is only trustworthy if it's POSSIBLE. A real cut is
// amount × pct/100, and pct ≤ 100, so a cut can never exceed the sale it's on (nor
// be negative). A bad POS write once stored cuts ~466× too large (fixed
// 2026-08-11); every read here did `commission_amount ?? derived`, trusting those
// corrupt values verbatim and inflating the commission line by thousands. This is
// the ONE guard: trust a stored cut only when sane; otherwise fall back to the
// derived amount × pct/100. `pct` is the barber's whole-number percentage.
export function safeCommission(amount: number | null | undefined, stored: number | null | undefined, pct: number): number {
  const amt = Math.max(0, amount ?? 0);
  const derived = (amt * pct) / 100;
  if (stored == null || !Number.isFinite(stored) || stored < 0 || stored > amt) return derived;
  return stored;
}

// What the barber earned on ONE transaction — their service commission + their
// tip. No card fee is deducted (the shop bears it entirely). An owner on their
// own chair keeps 100% of the service (isOwner), so both the row cut and the
// period headline reflect the barber's full take + tips.
export function barberRowCut(t: EarningTx, commissionPercent: number, isOwner = false): number {
  // A refund row takes the cut and the tip back (negative).
  if (isRefundTx(t)) return -refundClawback(t, commissionPercent, isOwner) - Math.abs(t.tip ?? 0);
  const cut = isOwner ? Math.max(0, t.amount) : safeCommission(t.amount, t.commission_amount, commissionPercent);
  return cut + (t.tip ?? 0);
}

// Shop-wide barber commission for a set of transactions — the SAME ledger + the
// SAME formula the barber portal reads, so the dashboard/Analytics "barber
// commission" line equals the sum of what every barber sees they earned. Only
// rows tied to a barber count (gift/product/no-barber sales carry no barber_id →
// shop revenue, no commission). Refunds claw back on their own day. commission_amount is the
// stored cut (POS); appointment-completion rows store none, so it falls back to
// the barber's rate × the service amount — identical to computeBarberEarnings.
export function shopBarberCommission(
  txs: Array<{ amount: number | null; commission_amount?: number | null; barber_id?: string | null; refunded?: boolean | null; source?: string | null; service_name?: string | null }>,
  pctByBarber: Record<string, number>,
): number {
  return txs.reduce((sum, t) => {
    if (!t.barber_id) return sum;
    // A refund row takes its cut back on its own day; the refunded sale keeps its cut.
    if (isRefundTx(t)) return sum - refundClawback({ ...t, amount: t.amount ?? 0 }, pctByBarber[t.barber_id] ?? 0);
    const pct = pctByBarber[t.barber_id] ?? 0;
    return sum + safeCommission(t.amount, t.commission_amount, pct);
  }, 0);
}

export function computeBarberEarnings(txs: EarningTx[], commissionPercent: number, isOwner = false): BarberEarnings {
  // A refunded sale still counts on its own day; its refund row takes the cut +
  // tip back on the refund's day (see REFUNDS above). No-show money counts too
  // (see NO-SHOWS above).
  const list = txs;
  const sales = list.filter(t => !isRefundTx(t));
  const refunds = list.filter(isRefundTx);
  const tips = sales.reduce((s, t) => s + (t.tip ?? 0), 0) - refunds.reduce((s, t) => s + Math.abs(t.tip ?? 0), 0);
  const serviceAmount = sales.reduce((s, t) => s + t.amount, 0) - refunds.reduce((s, t) => s + Math.abs(t.amount), 0);
  const revenue = serviceAmount + tips;
  // Owner on their own chair keeps 100% of the service (see header note); a real
  // barber keeps their configured % (stored cut when sane, else derived).
  const commission = (isOwner
    ? sales.reduce((s, t) => s + Math.max(0, t.amount), 0)
    : sales.reduce((s, t) => s + safeCommission(t.amount, t.commission_amount, commissionPercent), 0))
    - refunds.reduce((s, t) => s + refundClawback(t, commissionPercent, isOwner), 0);
  const stripeFee = sales.reduce((s, t) => s + (t.stripe_fee ?? 0), 0);
  // The shop bears the ENTIRE card fee: the barber's take-home is commission +
  // tips with nothing deducted, and the shop's cut absorbs the full fee.
  const barberFeeShare = 0;
  const youKeep = commission + tips;
  const shopKeeps = Math.max(0, serviceAmount - commission - stripeFee);
  return {
    revenue, serviceAmount, commission, tips, stripeFee, barberFeeShare,
    youKeep, shopKeeps, count: sales.length, avgTicket: sales.length ? sales.reduce((s, t) => s + t.amount + (t.tip ?? 0), 0) / sales.length : 0,
  };
}
