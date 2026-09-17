import { collectedTotals, countablePosTxs, isPaid, type ByPi, type RevAppt, type RevTx } from "./revenue";

/** Missing Stripe entries mean unknown fees, never confirmed zero fees. */
export function analyticsFeesKnown(appts: RevAppt[], txs: RevTx[], byPi: ByPi) {
  const known = (row: { payment_method?: string | null; payment_intent_id?: string | null }) =>
    row.payment_method === "cash" || (!(row.payment_intent_id || row.payment_method === "card" || row.payment_method === "online")) || !!(row.payment_intent_id && byPi[row.payment_intent_id]);
  const counted = new Set(countablePosTxs(appts, txs));
  const paidPis = new Set(appts.filter(a => isPaid(a.payment_status) && a.status !== "no-show").map(a => a.payment_intent_id).filter(Boolean));
  return appts.every(a => !isPaid(a.payment_status) || a.status === "no-show" || collectedTotals([a], []).gross <= 0 || known(a)) &&
    txs.every(t => {
      if (t.refunded) return true;
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
export function analyticsRevenueBuckets(appts: DatedAppt[], txs: RevTx[], range: ReturnType<typeof analyticsPeriod>) {
  const daily = new Map<string, number>();
  for (const d = new Date(range.start); d < range.end; d.setDate(d.getDate() + 1)) daily.set(localDateKey(d), 0);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour: `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`, revenue: 0 }));
  const add = (timestamp: string, gross: number) => {
    if (!timestampInPeriod(timestamp, range)) return;
    const d = new Date(timestamp), key = localDateKey(d);
    daily.set(key, (daily.get(key) ?? 0) + gross); hourly[d.getHours()].revenue += gross;
  };
  const paidPis = new Set(appts.filter(a => isPaid(a.payment_status) && a.status !== "no-show").map(a => a.payment_intent_id).filter(Boolean));
  for (const a of appts) add(a.paid_at ?? a.created_at, collectedTotals([a], []).gross);
  const countable = new Set(countablePosTxs(appts, txs));
  for (const tx of txs) {
    if (!countable.has(tx) && tx.source !== "completion" && tx.source !== "balance") continue;
    if (tx.source === "completion" && tx.payment_intent_id && paidPis.has(tx.payment_intent_id)) continue;
    add(tx.created_at, collectedTotals([], [tx]).gross);
  }
  return { daily: Array.from(daily, ([date, revenue]) => ({ date, label: parseLocalDate(date).toLocaleDateString("en-CA", { month: "short", day: "numeric" }), revenue })), hourly };
}

export function topServicesWithOther(values: Record<string, number>, count = 6) {
  const sorted = Object.entries(values).sort(([, a], [, b]) => b - a);
  const result = sorted.slice(0, count).map(([name, value]) => ({ name, value }));
  if (sorted.length > count) result.push({ name: "Other", value: sorted.slice(count).reduce((sum, [, value]) => sum + value, 0) });
  return result;
}
