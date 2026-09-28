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
 * Runs with the caller's client, so RLS still applies on the browser. A failed
 * read returns [] and the report falls back to window-only evidence (as before).
 */
export async function loadLinkedEvidence(
  db: SupabaseClient, shopId: string | null | undefined, appts: Pick<RevAppt, "id" | "payment_intent_id">[],
): Promise<RevTx[]> {
  const ids = Array.from(new Set(appts.map(a => a.id).filter((v): v is string => !!v)));
  const pis = Array.from(new Set(appts.map(a => a.payment_intent_id).filter((v): v is string => !!v)));
  if (!shopId || (!ids.length && !pis.length)) return [];
  const reads = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    reads.push(db.from("transactions").select(EVIDENCE_COLS).eq("shop_id", shopId).in("appointment_id", ids.slice(i, i + CHUNK)));
  }
  for (let i = 0; i < pis.length; i += CHUNK) {
    reads.push(db.from("transactions").select(EVIDENCE_COLS).eq("shop_id", shopId).in("payment_intent_id", pis.slice(i, i + CHUNK)));
  }
  try {
    const results = await Promise.all(reads);
    if (results.some(r => r.error)) return [];
    return results.flatMap(r => (r.data ?? []) as unknown as RevTx[]);
  } catch {
    return [];
  }
}
