import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Insert a card-sale ledger row, dropping ONLY optional columns prod may still
 * lack (listed in `optional`) — and only when the DB error names that exact
 * column as missing. Identity columns (payment_intent_id, stripe_session_id) are
 * never dropped: a card sale saved without its Stripe id can't be de-duplicated
 * on retry (double revenue) or matched to its real fee (a permanent "≈"). Any
 * other failure is returned as-is so the caller fails loudly; the charge already
 * succeeded in Stripe, so retrying the same payment records it without charging
 * again.
 */
export async function insertLedgerRow(row: Record<string, unknown>, optional: readonly string[]) {
  let current = { ...row };
  let ins = await supabaseAdmin.from("transactions").insert(current).select("id").single();
  while (ins.error && /column|does not exist|schema cache/i.test(ins.error.message)) {
    const message = ins.error.message;
    // Postgres: column "tax" of relation … does not exist; PostgREST: Could not
    // find the 'tax' column … in the schema cache. Match the quoted name so e.g.
    // "syntax" never reads as the tax column.
    const missing = optional.find(c => c in current && (message.includes(`"${c}"`) || message.includes(`'${c}'`)));
    if (!missing) break;
    const rest = { ...current };
    delete rest[missing];
    current = rest;
    ins = await supabaseAdmin.from("transactions").insert(current).select("id").single();
  }
  return ins;
}
