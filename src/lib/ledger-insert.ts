import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * The database rules that make one Stripe charge one ledger row: the phase67
 * payment-id rule (refund audit rows excluded) and the existing Checkout-session
 * rule. A save that trips one of these lost a race to another save of the SAME
 * charge (webhook retry vs. return route, a double tap) — nothing was lost.
 */
const ONE_ROW_PER_CHARGE = /transactions_one_row_per_charge|transactions_stripe_session_id_unique/;

export function isDuplicateChargeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  return e.code === "23505" && ONE_ROW_PER_CHARGE.test(String(e.message ?? ""));
}

/**
 * The row that won the race, verified to be THIS shop's record of THIS charge
 * (and booking, when given). null = it can't be verified, so the caller keeps
 * the original error visible instead of reporting success.
 */
export async function verifiedChargeRow(key: {
  shopId: string | null | undefined;
  paymentIntentId?: string | null;
  stripeSessionId?: string | null;
  appointmentId?: string | null;
}): Promise<{ id: string } | null> {
  if (!key.shopId || (!key.paymentIntentId && !key.stripeSessionId)) return null;
  try {
    const q = supabaseAdmin.from("transactions").select("id, shop_id, appointment_id, source");
    const { data, error } = await (key.paymentIntentId
      ? q.eq("payment_intent_id", key.paymentIntentId)
      : q.eq("stripe_session_id", key.stripeSessionId!));
    if (error || !data) return null;
    const rows = (data as { id: string; shop_id: string | null; appointment_id: string | null; source: string | null }[])
      .filter(r => r.source !== "refund");
    const row = rows.length === 1 ? rows[0] : null;
    if (!row || row.shop_id !== key.shopId) return null;
    if (key.appointmentId && row.appointment_id && row.appointment_id !== key.appointmentId) return null;
    return { id: row.id };
  } catch {
    return null;
  }
}

/**
 * A failed ledger save that is really "this charge is already recorded" becomes
 * the verified existing row; any other error (or an unverifiable conflict) is
 * returned unchanged so it stays visible.
 */
export async function resolveDuplicateCharge(
  error: unknown,
  key: Parameters<typeof verifiedChargeRow>[0],
): Promise<{ error: unknown; existing: { id: string } | null }> {
  if (!isDuplicateChargeError(error)) return { error, existing: null };
  const existing = await verifiedChargeRow(key);
  return existing ? { error: null, existing } : { error, existing: null };
}

/**
 * Insert a card-sale ledger row, dropping ONLY optional columns prod may still
 * lack (listed in `optional`) — and only when the DB error names that exact
 * column as missing. Identity columns (payment_intent_id, stripe_session_id) are
 * never dropped: a card sale saved without its Stripe id can't be de-duplicated
 * on retry (double revenue) or matched to its real fee (a permanent "≈"). Any
 * other failure is returned as-is so the caller fails loudly; the charge already
 * succeeded in Stripe, so retrying the same payment records it without charging
 * again. A concurrent save of the same charge returns the verified existing row
 * with `duplicate: true` — the caller must not repeat the sale's side effects.
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
  if (ins.error && isDuplicateChargeError(ins.error)) {
    const existing = await verifiedChargeRow({
      shopId: row.shop_id as string | null,
      paymentIntentId: row.payment_intent_id as string | null,
      stripeSessionId: row.stripe_session_id as string | null,
    });
    if (existing) return { data: existing, error: null, duplicate: true as const };
  }
  return { data: ins.data, error: ins.error, duplicate: false as const };
}
