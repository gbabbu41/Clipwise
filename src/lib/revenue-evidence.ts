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

export type EvidenceSnapshot = { key: string; version: string; rows: RevTx[] };
export type EvidenceView = { rows: RevTx[]; status: "verified" | "updating" | "stale" | "loading" | "unavailable";
  loading: boolean; updating: boolean; stale: boolean; unavailable: boolean };

/**
 * What a report may show. `key` = "<shop>|<booking ids>" (the report window);
 * `version` = token of the report data currently on screen (changes on every
 * load/refresh); `good` = last SUCCESSFUL evidence load; `failed` = the load that
 * last failed. Evidence is only ever reused for the SAME shop and window:
 *  - verified    → loaded for this window and this data version;
 *  - updating    → valid result for this window, newer data not yet verified:
 *                  show it marked "Updating…";
 *  - stale       → that refresh failed: keep the previous result, flag it;
 *  - loading     → no valid result for this window yet (first load / new window):
 *                  show the loading state, never another window's evidence;
 *  - unavailable → failed with no valid result: don't show the figures.
 * A window with no bookings needs no evidence (verified).
 */
export function evidenceView(key: string, version: string, good: EvidenceSnapshot | null, failed: { key: string; version: string } | null): EvidenceView {
  const make = (status: EvidenceView["status"], rows: RevTx[] = []): EvidenceView =>
    ({ rows, status, loading: status === "loading", updating: status === "updating", stale: status === "stale", unavailable: status === "unavailable" });
  if (!key || key.endsWith("|")) return make("verified");
  const failedNow = !!failed && failed.key === key && failed.version === version;
  if (good && good.key === key) {
    if (good.version === version) return make("verified", good.rows);
    return make(failedNow ? "stale" : "updating", good.rows);
  }
  return make(failedNow ? "unavailable" : "loading");
}
