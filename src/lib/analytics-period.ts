import { appointmentGross, collectedTotals, countablePosTxs, grossContext, isGiftRefundRow, isRefundRow, isSale, noShowFeeVisit, paidAheadPis, refundedAmount, transactionCollectedAmount, type ByPi, type RevAppt, type RevTx } from "./revenue";

/** Missing Stripe entries mean unknown fees, never confirmed zero fees. */
export function analyticsFeesKnown(appts: RevAppt[], txs: RevTx[], byPi: ByPi) {
  const known = (row: { payment_method?: string | null; payment_intent_id?: string | null }) =>
    row.payment_method === "cash" || (!(row.payment_intent_id || row.payment_method === "card" || row.payment_method === "online")) || !!(row.payment_intent_id && byPi[row.payment_intent_id]);
  const counted = new Set(countablePosTxs(appts, txs));
  const ahead = paidAheadPis(txs);
  const paidPis = new Set(appts.filter(a => isSale(a.payment_status) && !noShowFeeVisit(a, ahead)).map(a => a.payment_intent_id).filter(Boolean));
  return appts.every(a => !isSale(a.payment_status) || noShowFeeVisit(a, ahead) || collectedTotals([a], []).gross <= 0 || known(a)) &&
    txs.every(t => {
      if (isRefundRow(t)) return true;   // a refund carries no new fee
      if (t.source === "completion" && t.payment_intent_id && paidPis.has(t.payment_intent_id)) return true;
      const movesMoney = counted.has(t) ? collectedTotals([], [t]).gross > 0
        : t.source === "balance" ? (t.amount ?? 0) + (t.tax ?? 0) + (t.tip ?? 0) > 0
        : t.source === "completion" && (t.tip ?? 0) > 0;
      return !movesMoney || known(t);
    });
}

export const hasMissingCardFees = (appts: RevAppt[], txs: RevTx[], byPi: ByPi) => !analyticsFeesKnown(appts, txs, byPi);

export const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const parseLocalDate = (key: string) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };

/** Browser-local calendar boundaries; end is exclusive, including across DST. */
export function analyticsPeriod(period: string, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (period === "week") {
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  } else if (period === "year") start.setMonth(0, 1);
  else if (period === "last") { start.setDate(1); end.setTime(start.getTime()); start.setMonth(start.getMonth() - 1); }
  else if (period !== "today") start.setDate(1);
  return { start, end, startDate: localDateKey(start), endDate: localDateKey(end), startIso: start.toISOString(), endIso: end.toISOString() };
}
export function timestampInPeriod(value: string, range: ReturnType<typeof analyticsPeriod>) {
  const time = new Date(value).getTime(); return time >= range.start.getTime() && time < range.end.getTime();
}

type DatedAppt = RevAppt & { paid_at?: string | null; created_at: string };
/** Attribute shared collected gross to days/hours, deduplicating across the whole period first. */
export function analyticsRevenueBuckets(appts: DatedAppt[], txs: RevTx[], range: ReturnType<typeof analyticsPeriod>, byPi?: ByPi, evidence: RevTx[] = []) {
  const daily = new Map<string, number>();
  for (const d = new Date(range.start); d < range.end; d.setDate(d.getDate() + 1)) daily.set(localDateKey(d), 0);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour: `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`, revenue: 0 }));
  const add = (timestamp: string, gross: number) => {
    if (!timestampInPeriod(timestamp, range)) return;
    const d = new Date(timestamp), key = localDateKey(d);
    daily.set(key, (daily.get(key) ?? 0) + gross); hourly[d.getHours()].revenue += gross;
  };
  // Same collected-gross rule as the headline (collectedTotals), so the bars sum to it:
  // a sale on its paid day (even if refunded later), a refund on its own day.
  const ctx = grossContext(appts, txs, byPi, evidence);
  const paidPis = new Set(appts.filter(a => isSale(a.payment_status) && !noShowFeeVisit(a, ctx.paidAhead)).map(a => a.payment_intent_id).filter(Boolean));
  for (const a of appts) {
    if (!isSale(a.payment_status) || noShowFeeVisit(a, ctx.paidAhead)) continue;
    add(a.paid_at ?? a.created_at, appointmentGross(a, ctx).gross);
  }
  const countable = new Set(countablePosTxs(appts, txs));
  for (const tx of txs) {
    if (isRefundRow(tx)) { if (!isGiftRefundRow(tx)) add(tx.created_at, -refundedAmount(tx)); continue; }   // gift-card part moves no money
    if (!countable.has(tx) && tx.source !== "completion" && tx.source !== "balance") continue;
    if (tx.source === "completion" && tx.payment_intent_id && paidPis.has(tx.payment_intent_id)) continue;
    // A later-collected balance lands on its own day (the booking line excludes it).
    const g = tx.source === "balance"
      ? transactionCollectedAmount(tx)
      : collectedTotals([], [tx]).gross;
    add(tx.created_at, g);
  }
  return { daily: Array.from(daily, ([date, revenue]) => ({ date, label: parseLocalDate(date).toLocaleDateString("en-CA", { month: "short", day: "numeric" }), revenue })), hourly };
}

export function topServicesWithOther(values: Record<string, number>, count = 6) {
  const sorted = Object.entries(values).sort(([, a], [, b]) => b - a);
  const result = sorted.slice(0, count).map(([name, value]) => ({ name, value }));
  if (sorted.length > count) result.push({ name: "Other", value: sorted.slice(count).reduce((sum, [, value]) => sum + value, 0) });
  return result;
}
