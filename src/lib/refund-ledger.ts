import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logLedgerSaveFailure } from "@/lib/ledger-log";

/**
 * The refund record's id, derived from the charge's payment id — so the primary
 * key allows ONE refund record per charge, even when the refund route and the
 * charge.refunded webhook save it at the same moment. (phase67's one-row-per-
 * charge rule deliberately excludes refund records; this is their own guard.)
 */
export function refundRecordId(paymentIntentId: string): string {
  const h = createHash("sha256").update(`clipwise-refund-ledger:${paymentIntentId}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Write a dated, NEGATIVE refund record to the transactions ledger — the audit
 * trail + GST/HST claim-back record a refund needs ("how much did we refund in
 * August", and the tax you reclaim on money handed back).
 *
 * COUNTED as money out on the day of the refund (owner rule 2026-10-02): the
 * refunded sale keeps counting on its own paid day and this row subtracts the
 * refunded amount from gross / net / tax / tips in whatever window holds the
 * refund (lib/revenue collectedTotals). So EVERY real refund must have this row —
 * a refund without one would leave the sale counted with nothing taken back.
 * payment_intent_id dedupes it (a refund can arrive from our route AND the
 * charge.refunded webhook); it is never used for fee math (Stripe keeps the
 * original fee, which stays on the sale).
 *
 * Stored with refunded=true so per-barber earnings / rankings (which skip
 * refunded rows) never treat it as a sale, and it can never itself be
 * re-refunded. Revenue finds it by source="refund", not the flag.
 *
 * Best-effort with a column-drop retry so a lagging schema can never break a
 * refund that already went through on Stripe. Saving it never calls Stripe, so
 * re-saving (a webhook redelivery) can't refund the customer again; a save that
 * fails is logged to error_logs (ids only), never swallowed.
 */
export async function recordRefundLedger(args: {
  shopId: string;
  barberId?: string | null;
  clientName?: string | null;
  serviceName?: string | null;
  refundedCents: number;          // total returned to the customer (incl. tax + tip)
  taxCents?: number;              // tax portion of the refund (GST/HST claim-back)
  tipCents?: number;              // tip portion returned
  appointmentId?: string | null;
  paymentIntentId?: string | null;
}): Promise<"recorded" | "already" | "failed" | "skipped"> {
  const refunded = Math.max(0, Math.round(args.refundedCents));
  if (refunded <= 0 || !args.shopId) return "skipped";

  // Dedupe by PaymentIntent — if a refund row for this charge already exists, stop.
  if (args.paymentIntentId) {
    const { data: existing } = await supabaseAdmin.from("transactions")
      .select("id").eq("source", "refund").eq("payment_intent_id", args.paymentIntentId).limit(1).maybeSingle();
    if (existing) return "already";
  }

  const tax = Math.min(refunded, Math.max(0, Math.round(args.taxCents ?? 0)));
  const tip = Math.min(refunded - tax, Math.max(0, Math.round(args.tipCents ?? 0)));
  const service = Math.max(0, refunded - tax - tip);

  const row: Record<string, unknown> = {
    ...(args.paymentIntentId ? { id: refundRecordId(args.paymentIntentId) } : {}),
    shop_id: args.shopId,
    barber_id: args.barberId ?? null,
    client_name: args.clientName ?? null,
    service_name: args.serviceName ? `Refund — ${args.serviceName}` : "Refund",
    amount: -(service / 100), tip: -(tip / 100), tax: -(tax / 100),
    // `type` is CHECK-constrained to service|product|tip; a refund record is
    // identified by source "refund" (every report excludes it by that).
    payment_method: "card", type: "service", source: "refund",
    appointment_id: args.appointmentId ?? null,
    payment_intent_id: args.paymentIntentId ?? null,
    refunded: true, stripe_fee: 0,
  };
  let saveError: unknown = null;
  try {
    const res = await supabaseAdmin.from("transactions").insert(row);
    saveError = res.error;
    if (res.error && /column|does not exist|schema cache/i.test(res.error.message)) {
      const { stripe_fee: _f, appointment_id: _a, ...base } = row; void _f; void _a;
      saveError = (await supabaseAdmin.from("transactions").insert(base)).error;
    }
  } catch (e) { saveError = e; }
  if (!saveError) return "recorded";

  // A concurrent save of this charge's refund record won the race (same id):
  // verified as that record, nothing is lost.
  const e = saveError as { code?: unknown; message?: unknown };
  if (args.paymentIntentId && e.code === "23505" && /transactions_pkey/.test(String(e.message ?? ""))) {
    const { data: winner } = await supabaseAdmin.from("transactions")
      .select("id, shop_id, source, payment_intent_id").eq("id", refundRecordId(args.paymentIntentId)).maybeSingle()
      .then(r => r, () => ({ data: null }));
    if (winner && winner.source === "refund" && winner.payment_intent_id === args.paymentIntentId && winner.shop_id === args.shopId) return "already";
  }
  await logLedgerSaveFailure("refund-ledger", { shopId: args.shopId, appointmentId: args.appointmentId, paymentIntentId: args.paymentIntentId }, saveError);
  return "failed";
}
