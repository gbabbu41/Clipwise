import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Write a dated, NEGATIVE refund record to the transactions ledger — the audit
 * trail + GST/HST claim-back record a refund needs ("how much did we refund in
 * August", and the tax you reclaim on money handed back).
 *
 * AUDIT-ONLY: source "refund" is EXCLUDED from all revenue math (see
 * countablePosTxs), so it never double-counts — a full refund already drops its
 * revenue via the original row's payment_status/refunded flag. This row exists to
 * be listed and reported, dated at the moment of the refund (the original row is
 * dated at the sale). payment_intent_id is stored ONLY to dedupe (a refund can
 * arrive from our route AND the charge.refunded webhook); it is never used for fee
 * math on these rows.
 *
 * The row is stored with refunded=true so EVERY existing `!refunded` filter
 * (analytics, barber earnings, collectedTotals) auto-excludes it — belt-and-braces
 * on top of the explicit source="refund" exclusion — and it can never itself be
 * re-refunded. It's found for reporting/dedupe by source="refund", not the flag.
 *
 * Best-effort with a column-drop retry so a lagging schema can never break a
 * refund that already went through on Stripe.
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
}): Promise<void> {
  const refunded = Math.max(0, Math.round(args.refundedCents));
  if (refunded <= 0 || !args.shopId) return;

  // Dedupe by PaymentIntent — if a refund row for this charge already exists, stop.
  if (args.paymentIntentId) {
    const { data: existing } = await supabaseAdmin.from("transactions")
      .select("id").eq("source", "refund").eq("payment_intent_id", args.paymentIntentId).limit(1).maybeSingle();
    if (existing) return;
  }

  const tax = Math.min(refunded, Math.max(0, Math.round(args.taxCents ?? 0)));
  const tip = Math.min(refunded - tax, Math.max(0, Math.round(args.tipCents ?? 0)));
  const service = Math.max(0, refunded - tax - tip);

  const row: Record<string, unknown> = {
    shop_id: args.shopId,
    barber_id: args.barberId ?? null,
    client_name: args.clientName ?? null,
    service_name: args.serviceName ? `Refund — ${args.serviceName}` : "Refund",
    amount: -(service / 100), tip: -(tip / 100), tax: -(tax / 100),
    payment_method: "card", type: "refund", source: "refund",
    appointment_id: args.appointmentId ?? null,
    payment_intent_id: args.paymentIntentId ?? null,
    refunded: true, stripe_fee: 0,
  };
  const res = await supabaseAdmin.from("transactions").insert(row);
  if (res.error && /column|does not exist|schema cache/i.test(res.error.message)) {
    const { stripe_fee: _f, appointment_id: _a, ...base } = row; void _f; void _a;
    await supabaseAdmin.from("transactions").insert(base).then(null, () => null);
  }
}
