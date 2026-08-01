// Shared "collected revenue" math so the Dashboard headline matches the
// Payments page to the penny. This MIRRORS the feed/de-dup logic in
// src/app/dashboard/payments/page.tsx (the source of truth, which is wired to
// Stripe + the transactions ledger). If that logic changes, update both.
//
// Model: gross COLLECTED = settled appointments (paid/captured) + settled POS
// transactions (gift-card sales, product/walk-in sales, no-show fees), with
// transactions de-duped against appointments so a card charge isn't counted
// twice. Gross includes tax + tips; `tax` is broken back out for the "+ tax"
// note, and `cash` is the cash portion for the "incl. cash" note.

export type RevAppt = {
  client_name: string | null;
  total_amount: number | null;
  tax_amount?: number | null;
  payment_status?: string | null;
  payment_method?: string | null;
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
  stripe_session_id?: string | null;
  source?: string | null;
  refunded?: boolean | null;
};

const isPaid = (s: string | null | undefined) => s === "paid" || s === "captured";
const isNoShowTx = (t: RevTx) => t.source === "no_show" || (t.service_name ?? "").startsWith("No-show fee");

export type CollectedTotals = {
  gross: number;   // everything collected, incl. tax + tips
  tax: number;     // tax portion of gross (for the "+ tax" note)
  cash: number;    // cash portion of gross (for the "incl. cash" note)
  preTax: number;  // gross − tax (the headline "revenue" number)
};

/**
 * Total collected across appointments + transactions for whatever slice the
 * caller passes in (already date-filtered). Mirrors the Payments page's feed.
 */
export function collectedTotals(appts: RevAppt[], txs: RevTx[]): CollectedTotals {
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

  let gross = 0, tax = 0, cash = 0;

  // Settled appointments — exclude paid no-shows (a no-show is represented by its
  // own transaction row so it isn't double-counted).
  for (const a of appts) {
    if (!isPaid(a.payment_status)) continue;
    if (a.status === "no-show") continue;
    const amt = a.total_amount ?? 0;
    gross += amt;
    tax += a.tax_amount ?? 0;
    if (a.payment_method === "cash") cash += amt;
  }

  // Settled POS / gift-card / walk-in transactions (skip refunded).
  for (const t of posTxs) {
    if (t.refunded) continue;
    const amt = (t.amount ?? 0) + (t.tip ?? 0);
    gross += amt;
    tax += t.tax ?? 0;
    if (t.payment_method === "cash") cash += amt;
  }

  return { gross, tax, cash, preTax: Math.max(0, gross - tax) };
}
