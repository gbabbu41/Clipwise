// Shared barber-earnings math — the ONE definition of "what a barber earned",
// used by BOTH the barber's own portal (/api/barber/earnings) and the owner's
// Payments page when it's filtered to a single barber. Filtering Payments by a
// barber must show EXACTLY what that barber sees in their own portal, so both
// screens compute from the same rows (that barber's `transactions`) with the
// same formula here. If this changes, both screens change together.
//
// Fee handling is intentionally left as-is (card fee split 50/50 with the shop);
// the owner asked to keep the Stripe-fee treatment unchanged.

export type EarningTx = {
  amount: number;                    // service amount (pre-tip)
  tip?: number | null;               // 100% the barber's
  commission_amount?: number | null; // stored cut; falls back to amount × pct
  stripe_fee?: number | null;        // real card fee on this charge (0 for cash)
  refunded?: boolean | null;
};

export type BarberEarnings = {
  revenue: number;        // service + tips the barber generated
  serviceAmount: number;  // service only (pre-tip)
  commission: number;     // the barber's service cut (their %)
  tips: number;           // 100% the barber's
  stripeFee: number;      // total card fee across these txs
  barberFeeShare: number; // the barber's half of the fee
  youKeep: number;        // TAKE-HOME = commission + tips − feeShare
  shopKeeps: number;      // service − commission − feeShare
  count: number;
  avgTicket: number;
};

// What the barber earned on ONE transaction — their service commission + their
// tip. The card fee is applied only at the aggregate (halved), same as the
// summary, so a row is the pre-fee cut and the period headline nets the fee out.
export function barberRowCut(t: EarningTx, commissionPercent: number): number {
  const commission = t.commission_amount ?? (t.amount * commissionPercent) / 100;
  return commission + (t.tip ?? 0);
}

export function computeBarberEarnings(txs: EarningTx[], commissionPercent: number): BarberEarnings {
  // Exclude refunded — a refunded charge must not keep inflating a barber's cut.
  // Filter in JS (not .neq) so rows where `refunded` is null/absent are kept.
  const list = txs.filter(t => !t.refunded);
  const tips = list.reduce((s, t) => s + (t.tip ?? 0), 0);
  const serviceAmount = list.reduce((s, t) => s + t.amount, 0);
  const revenue = serviceAmount + tips;
  const commission = list.reduce((s, t) => s + (t.commission_amount ?? (t.amount * commissionPercent) / 100), 0);
  const stripeFee = list.reduce((s, t) => s + (t.stripe_fee ?? 0), 0);
  const barberFeeShare = stripeFee / 2;
  const youKeep = Math.max(0, commission + tips - barberFeeShare);
  const shopKeeps = Math.max(0, serviceAmount - commission - barberFeeShare);
  return {
    revenue, serviceAmount, commission, tips, stripeFee, barberFeeShare,
    youKeep, shopKeeps, count: list.length, avgTicket: list.length ? revenue / list.length : 0,
  };
}
