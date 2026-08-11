// Shared "collected revenue" math so the Dashboard and the Payments page agree
// to the penny. This MIRRORS the feed/de-dup logic in
// src/app/dashboard/payments/page.tsx (the source of truth, wired to Stripe +
// the transactions ledger). If that logic changes, update both.
//
// Model: gross COLLECTED = settled appointments (paid/captured) + settled POS
// transactions (gift-card sales, product/walk-in sales, no-show fees), with
// transactions de-duped against appointments so a card charge isn't counted
// twice. Given the Stripe `byPi` map (paymentIntent -> {gross, fee, net}) it
// also returns the exact NET after Stripe fees and the total fees paid. Cash
// never touches Stripe, so it carries no fee (net === gross for cash).

export type RevAppt = {
  client_name: string | null;
  total_amount: number | null;   // service + tax (NOT tip — tip is its own column)
  tax_amount?: number | null;
  tip_amount?: number | null;     // booking tip, charged on the SAME intent
  gift_applied?: number | null;   // gift-card value applied — already counted at sale
  payment_status?: string | null;
  payment_method?: string | null;
  payment_intent_id?: string | null;
  status?: string | null;
};

export type RevTx = {
  client_name: string | null;
  service_name?: string | null;
  amount: number | null;
  tip?: number | null;
  tax?: number | null;
  payment_method: string | null;
  created_at: string;
  payment_intent_id?: string | null;
  stripe_session_id?: string | null;
  source?: string | null;
  refunded?: boolean | null;
};

// paymentIntent id -> exact figures from Stripe balance transactions.
export type ByPi = Record<string, { gross: number; fee: number; net: number }>;

export const isPaid = (s: string | null | undefined) => s === "paid" || s === "captured";
export const isNoShowTx = (t: RevTx) => t.source === "no_show" || (t.service_name ?? "").startsWith("No-show fee");

/**
 * The ONE rule for which transactions count as income (used by both the
 * Dashboard and the Payments page so they can never disagree). De-dups txs
 * against paid appointments (same client|amount) and drops completion-source
 * txs — the appointment already represents that charge.
 */
export function countablePosTxs<T extends RevTx>(appts: RevAppt[], txs: T[]): T[] {
  const paidSig = new Set(
    appts.filter(a => isPaid(a.payment_status)).map(a => `${a.client_name}|${a.total_amount}`),
  );
  return txs.filter(t => {
    if (isNoShowTx(t)) return true;
    if (t.source === "completion") return false;
    if (!t.source && !t.stripe_session_id && paidSig.has(`${t.client_name}|${t.amount}`)) return false;
    return true;
  });
}

/**
 * Net + fee for one charge line, the ONE place Stripe fees are applied. A card
 * charge with a matching Stripe balance-txn uses the exact net/fee; everything
 * else (cash, or not-yet-synced) nets to its gross with no fee.
 */
export function lineNetFee(pi: string | null | undefined, gross: number, byPi?: ByPi): { net: number; fee: number } {
  const b = pi && byPi ? byPi[pi] : undefined;
  return b ? { net: b.net, fee: b.fee } : { net: gross, fee: 0 };
}

export type CollectedTotals = {
  gross: number;   // everything collected, incl. tax + tips, before Stripe fees
  fees: number;    // total Stripe processing fees (card only)
  net: number;     // gross − fees (what actually lands; cash unaffected)
  tax: number;     // tax portion of gross (informational — owed to govt)
  cash: number;    // cash portion of gross (no fee)
  tips: number;    // tips collected (the barber's money, but it landed in the shop's Stripe)
  preTax: number;  // gross − tax
};

/**
 * Total collected across appointments + transactions for whatever slice the
 * caller passes in (already date-filtered). Pass the Stripe `byPi` map to get
 * exact net/fees; omit it and net === gross (fees 0).
 */
export function collectedTotals(appts: RevAppt[], txs: RevTx[], byPi?: ByPi): CollectedTotals {
  // Same income rule the Payments page uses (shared, so they can't disagree).
  const posTxs = countablePosTxs(appts, txs);

  let gross = 0, fees = 0, net = 0, tax = 0, cash = 0, tips = 0;

  // PaymentIntents accounted for by the appointment loop — a post-visit tip on
  // one of these intents is already inside the appointment, so it's skipped below.
  const apptPis = new Set<string>();

  // Settled appointments — exclude paid no-shows (represented by a tx row so it
  // isn't double-counted).
  for (const a of appts) {
    if (!isPaid(a.payment_status)) continue;
    if (a.status === "no-show") continue;
    // The customer paid: (service + tax) − gift already applied + the booking tip.
    //  · Subtract gift: that value was counted when the card was SOLD, so counting
    //    the full total here would double-count it (total_amount stays full for the
    //    receipt).
    //  · ADD the tip into gross (it rode the same charge). Without this, gross
    //    excluded the tip while net (from the real Stripe charge) included it — so
    //    net could read HIGHER than gross. Now gross ≥ net always, and every tip
    //    is counted consistently (same as POS + post-visit tips).
    const svcTax = Math.max(0, (a.total_amount ?? 0) - (a.gift_applied ?? 0));
    const apptTip = Math.max(0, a.tip_amount ?? 0);
    const lineGross = svcTax + apptTip;
    const { net: n, fee: f } = lineNetFee(a.payment_intent_id, lineGross, byPi);
    gross += lineGross; net += n; fees += f;
    tax += a.tax_amount ?? 0;
    tips += apptTip;
    if (a.payment_method === "cash") cash += lineGross;
    if (a.payment_intent_id) apptPis.add(a.payment_intent_id);
  }

  // Settled POS / gift-card / walk-in transactions (skip refunded). POS tips are
  // part of `amount + tip` here.
  for (const t of posTxs) {
    if (t.refunded) continue;
    const amt = (t.amount ?? 0) + (t.tip ?? 0);
    const { net: n, fee: f } = lineNetFee(t.payment_intent_id, amt, byPi);
    gross += amt; net += n; fees += f;
    tax += t.tax ?? 0;
    tips += t.tip ?? 0;
    if (t.payment_method === "cash") cash += amt;
  }

  // Post-visit tips (the tip-link flow). These are `completion` transactions
  // that countablePosTxs drops, so the tip — real money that hit the shop's
  // Stripe — was previously counted NOWHERE on the owner side (it only showed in
  // the barber portal). A post-visit tip has its OWN PaymentIntent (not one of a
  // counted appointment), so we can add it to gross + net cleanly. A booking tip
  // shares the appointment's intent (pi ∈ apptPis) and is already inside that
  // appointment's net, so we skip it here to avoid double-counting.
  for (const t of txs) {
    if (t.source !== "completion" || t.refunded) continue;
    const tip = t.tip ?? 0;
    if (tip <= 0) continue;
    const pi = t.payment_intent_id ?? null;
    if (pi && apptPis.has(pi)) continue; // booking tip — already in the appt net
    gross += tip; tips += tip;
    const { net: n, fee: f } = lineNetFee(pi, tip, byPi);
    net += n; fees += f;
    if (t.payment_method === "cash") cash += tip;
  }

  return { gross, fees, net, tax, cash, tips, preTax: Math.max(0, gross - tax) };
}
