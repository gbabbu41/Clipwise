import type { SupabaseClient } from "@supabase/supabase-js";
import type { RevAppt, RevTx } from "./revenue";

export const EVIDENCE_COLS = "id, client_name, amount, tip, tax, payment_method, payment_intent_id, created_at, source, refunded, appointment_id";
const CHUNK = 100;

/**
 * Ledger rows LINKED to a report's bookings — the booking's own payment id, or
 * any row carrying the booking's id (a tip or balance on a different payment id)
 * — from ANY date, always scoped to one shop. Evidence only: pass it to
 * collectedTotals / analyticsRevenueBuckets as lookup data; it is never counted
 * as income, so each report keeps its own date window.
 *
 * Runs with the caller's client, so RLS still applies on the browser. `ok:false`
 * = a read failed: the figures that depend on it must be shown as stale or
 * unavailable (see evidenceView), never silently recomputed without it.
 */
export async function loadLinkedEvidence(
  db: SupabaseClient, shopId: string | null | undefined, appts: Pick<RevAppt, "id" | "payment_intent_id">[],
): Promise<{ ok: boolean; rows: RevTx[] }> {
  const ids = Array.from(new Set(appts.map(a => a.id).filter((v): v is string => !!v)));
  const pis = Array.from(new Set(appts.map(a => a.payment_intent_id).filter((v): v is string => !!v)));
  if (!ids.length && !pis.length) return { ok: true, rows: [] };   // nothing to verify
  if (!shopId) return { ok: false, rows: [] };
  const reads = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    reads.push(db.from("transactions").select(EVIDENCE_COLS).eq("shop_id", shopId).in("appointment_id", ids.slice(i, i + CHUNK)));
  }
  for (let i = 0; i < pis.length; i += CHUNK) {
    reads.push(db.from("transactions").select(EVIDENCE_COLS).eq("shop_id", shopId).in("payment_intent_id", pis.slice(i, i + CHUNK)));
  }
  try {
    const results = await Promise.all(reads);
    if (results.some(r => r.error)) return { ok: false, rows: [] };
    return { ok: true, rows: results.flatMap(r => (r.data ?? []) as unknown as RevTx[]) };
  } catch {
    return { ok: false, rows: [] };
  }
}

export type EvidenceSnapshot = { key: string; rows: RevTx[] };
/**
 * What a report may show for its current evidence `key`, given the last
 * SUCCESSFUL load and the key whose latest load FAILED:
 *  - success for this key → its rows; if a later reload failed, `stale` (show the
 *    previous valid result with a stale notice);
 *  - failed with no valid result for this key → `unavailable` (don't show the
 *    collected figures — they'd be recomputed without the payment evidence);
 *  - still loading → the previous valid rows (lookup-only, valid per booking).
 */
export function evidenceView(key: string, good: EvidenceSnapshot | null, failedKey: string | null): { rows: RevTx[]; stale: boolean; unavailable: boolean } {
  const failed = !!key && failedKey === key;
  if (good && good.key === key) return { rows: good.rows, stale: failed, unavailable: false };
  // Keys start with the shop id — never reuse another shop's rows.
  const sameShop = !!good && good.key.split("|")[0] === key.split("|")[0];
  return { rows: sameShop ? good!.rows : [], stale: false, unavailable: failed };
}
