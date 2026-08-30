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
// tip. The card fee is applied only at the aggregate (halved), same as the
// summary, so a row is the pre-fee cut and the period headline nets the fee out.
export function barberRowCut(t: EarningTx, commissionPercent: number): number {
  return safeCommission(t.amount, t.commission_amount, commissionPercent) + (t.tip ?? 0);
}

// Shop-wide barber commission for a set of transactions — the SAME ledger + the
// SAME formula the barber portal reads, so the dashboard/Analytics "barber
// commission" line equals the sum of what every barber sees they earned. Only
// rows tied to a barber count (gift/product/no-barber sales carry no barber_id →
// shop revenue, no commission). Refunded rows excluded. commission_amount is the
// stored cut (POS); appointment-completion rows store none, so it falls back to
// the barber's rate × the service amount — identical to computeBarberEarnings.
export function shopBarberCommission(
  txs: Array<{ amount: number | null; commission_amount?: number | null; barber_id?: string | null; refunded?: boolean | null; source?: string | null; service_name?: string | null }>,
  pctByBarber: Record<string, number>,
): number {
  return txs.reduce((sum, t) => {
    if (t.refunded || !t.barber_id) return sum;
    // No-show penalty fees are shop income, not a service the barber performed —
    // they never pay commission (matches the Dashboard + barber-portal rule).
    if (t.source === "no_show" || (t.service_name ?? "").startsWith("No-show fee")) return sum;
    const pct = pctByBarber[t.barber_id] ?? 0;
    return sum + safeCommission(t.amount, t.commission_amount, pct);
  }, 0);
}

export function computeBarberEarnings(txs: EarningTx[], commissionPercent: number): BarberEarnings {
  // Exclude refunded — a refunded charge must not keep inflating a barber's cut.
  // Filter in JS (not .neq) so rows where `refunded` is null/absent are kept.
  const list = txs.filter(t => !t.refunded);
  const tips = list.reduce((s, t) => s + (t.tip ?? 0), 0);
  const serviceAmount = list.reduce((s, t) => s + t.amount, 0);
  const revenue = serviceAmount + tips;
  const commission = list.reduce((s, t) => s + safeCommission(t.amount, t.commission_amount, commissionPercent), 0);
  const stripeFee = list.reduce((s, t) => s + (t.stripe_fee ?? 0), 0);
  const barberFeeShare = stripeFee / 2;
  const youKeep = Math.max(0, commission + tips - barberFeeShare);
  const shopKeeps = Math.max(0, serviceAmount - commission - barberFeeShare);
  return {
    revenue, serviceAmount, commission, tips, stripeFee, barberFeeShare,
    youKeep, shopKeeps, count: list.length, avgTicket: list.length ? revenue / list.length : 0,
  };
}
