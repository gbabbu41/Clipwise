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
  total_amount: number | null;
  tax_amount?: number | null;
  payment_status?: string | null;
  payment_method?: string | null;
  payment_intent_id?: string | null;
  status: string;
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

const isPaid = (s: string | null | undefined) => s === "paid" || s === "captured";
const isNoShowTx = (t: RevTx) => t.source === "no_show" || (t.service_name ?? "").startsWith("No-show fee");

export type CollectedTotals = {
  gross: number;   // everything collected, incl. tax + tips, before Stripe fees
  fees: number;    // total Stripe processing fees (card only)
  net: number;     // gross − fees (what actually lands; cash unaffected)
  tax: number;     // tax portion of gross (informational — owed to govt)
  cash: number;    // cash portion of gross (no fee)
  preTax: number;  // gross − tax
};

/**
 * Total collected across appointments + transactions for whatever slice the
 * caller passes in (already date-filtered). Pass the Stripe `byPi` map to get
 * exact net/fees; omit it and net === gross (fees 0).
 */
export function collectedTotals(appts: RevAppt[], txs: RevTx[], byPi?: ByPi): CollectedTotals {
  // De-dup transactions against paid appointments (same client|amount) and drop
  // completion-source txs — the appointment already represents that charge.
  const paidSig = new Set(
    appts.filter(a => isPaid(a.payment_status)).map(a => `${a.client_name}|${a.total_amount}`),
  );
  const posTxs = txs.filter(t => {
    if (isNoShowTx(t)) return true;
    if (t.source === "completion") return false;
    if (!t.source && !t.stripe_session_id && paidSig.has(`${t.client_name}|${t.amount}`)) return false;
    return true;
  });

  // Net + fee for one card/cash line, mirroring the Payments page's netOf/feeOf:
  // a card charge with a matching Stripe balance-txn uses the exact net/fee;
  // everything else (cash, or not-yet-synced) nets to its gross with no fee.
  const lineNetFee = (pi: string | null | undefined, gross: number) => {
    const b = pi && byPi ? byPi[pi] : undefined;
    return b ? { net: b.net, fee: b.fee } : { net: gross, fee: 0 };
  };

  let gross = 0, fees = 0, net = 0, tax = 0, cash = 0;

  // Settled appointments — exclude paid no-shows (represented by a tx row so it
  // isn't double-counted).
  for (const a of appts) {
    if (!isPaid(a.payment_status)) continue;
    if (a.status === "no-show") continue;
    const amt = a.total_amount ?? 0;
    const { net: n, fee: f } = lineNetFee(a.payment_intent_id, amt);
    gross += amt; net += n; fees += f;
    tax += a.tax_amount ?? 0;
    if (a.payment_method === "cash") cash += amt;
  }

  // Settled POS / gift-card / walk-in transactions (skip refunded).
  for (const t of posTxs) {
    if (t.refunded) continue;
    const amt = (t.amount ?? 0) + (t.tip ?? 0);
    const { net: n, fee: f } = lineNetFee(t.payment_intent_id, amt);
    gross += amt; net += n; fees += f;
    tax += t.tax ?? 0;
    if (t.payment_method === "cash") cash += amt;
  }

  return { gross, fees, net, tax, cash, preTax: Math.max(0, gross - tax) };
}
