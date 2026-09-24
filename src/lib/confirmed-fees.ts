import type { ByPi } from "@/lib/revenue";

export type FeeRow = {
  id: string;
  payment_intent_id: string | null;
  stripe_fee: number | null;
  amount: number | null;
  tax: number | null;
  tip: number | null;
  payment_method: string | null;
  refunded: boolean | null;
  source: string | null;
};

/** A positive recorded fee is confirmed. The legacy schema defaults card fees
 * to 0, so 0 cannot prove Stripe charged nothing and must remain unresolved. */
export function confirmedFeesFromRows(rows: FeeRow[]): ByPi {
  const byPi: ByPi = {};
  for (const row of rows) {
    const pi = row.payment_intent_id;
    const fee = Number(row.stripe_fee);
    if (!pi || row.payment_method !== "card" || row.refunded || row.source === "refund" ||
        !Number.isFinite(fee) || fee <= 0 || byPi[pi]) continue;
    const gross = Number(row.amount ?? 0) + Number(row.tax ?? 0) + Number(row.tip ?? 0);
    if (!Number.isFinite(gross) || gross <= 0) continue;
    byPi[pi] = { gross, fee, net: gross - fee };
  }
  return byPi;
}

/** One Stripe lookup per missing PaymentIntent, even if replayed ledger rows or
 * the corresponding appointment also name it. Preserve the caller's recency
 * order so fresh charges get the limited lookup slots first. */
export function missingFeeIntents(
  rows: FeeRow[], appointmentIntents: Array<string | null>, confirmed: ByPi, max: number,
): string[] {
  const seen = new Set(Object.keys(confirmed));
  const result: string[] = [];
  const add = (pi: string | null) => {
    if (!pi || seen.has(pi) || result.length >= max) return;
    seen.add(pi); result.push(pi);
  };
  for (const row of rows) {
    if (row.payment_method === "card" && !row.refunded && row.source !== "refund" &&
        !(Number.isFinite(row.stripe_fee) && (row.stripe_fee as number) > 0)) add(row.payment_intent_id);
  }
  for (const pi of appointmentIntents) add(pi);
  return result;
}
