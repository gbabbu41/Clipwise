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
  // A part with no card charge (cash, gift card) passes its own stable key here
  // instead ("cash:<booking id>", "gift:<booking id>", "cash:<sale id>").
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
 * One record per Stripe refund (keyed by its re_… id — a charge refunded in
 * parts gets one record per part, each on its own day) and per non-card PART of
 * a refund (lib/refund-plan, keyed by `dedupeKey`). A gift-card part
 * (method "gift_card") moves no money — revenue only reverses its tax / tip.
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
  /** How the money went back: "card" (Stripe), "cash" (handed back in person) or
   *  "gift_card" (value put back on the card — moves no money, see lib/revenue). */
  method?: "card" | "cash" | "gift_card";
  /** Stable key for a part with no card charge — one record per part, ever. */
  dedupeKey?: string | null;
  /** Stripe's id for THIS refund (re_…). A charge can be refunded in several
   *  parts (e.g. $10 Monday, $30 Friday) — each Stripe refund gets its own record,
   *  keyed by its id, so the route and the webhook can never record one twice. */
  stripeRefundId?: string | null;
  /** When the money actually went back (Stripe's refund time) — the record's date.
   *  Defaults to now. */
  refundedAt?: string | null;
}): Promise<"recorded" | "already" | "failed" | "skipped"> {
  const refunded = Math.max(0, Math.round(args.refundedCents));
  if (refunded <= 0 || !args.shopId) return "skipped";
  const method = args.method ?? "card";
  // One record per Stripe refund (its id), per non-card part (dedupeKey), or —
  // only when neither is known — per charge (older callers / already-refunded).
  const key = args.stripeRefundId || args.dedupeKey || args.paymentIntentId || null;

  // Dedupe — if this refund's record already exists, stop.
  if (!args.stripeRefundId && !args.dedupeKey && args.paymentIntentId) {
    const { data: existing } = await supabaseAdmin.from("transactions")
      .select("id").eq("source", "refund").eq("payment_intent_id", args.paymentIntentId).limit(1).maybeSingle();
    if (existing) return "already";
  } else if (key) {
    const { data: existing } = await supabaseAdmin.from("transactions")
      .select("id").eq("id", refundRecordId(key)).maybeSingle();
    if (existing) return "already";
  }

  const tax = Math.min(refunded, Math.max(0, Math.round(args.taxCents ?? 0)));
  const tip = Math.min(refunded - tax, Math.max(0, Math.round(args.tipCents ?? 0)));
  const service = Math.max(0, refunded - tax - tip);

  // The sale's stored commission cut (POS sales store one), so the take-back on
  // the refund's day is exactly what the barber was credited — scaled to the
  // share of the service refunded (a $10 part of a $40 sale takes back a quarter).
  // Best-effort: without it the take-back is derived from the barber's rate.
  let saleCut: number | null = null;
  if (args.paymentIntentId) {
    try {
      const { data: sales } = await supabaseAdmin.from("transactions")
        .select("commission_amount, amount").eq("payment_intent_id", args.paymentIntentId).neq("source", "refund").limit(5);
      for (const r of (sales ?? []) as { commission_amount?: unknown; amount?: unknown }[]) {
        const c = Number(r.commission_amount), saleSvc = Math.round(Number(r.amount) * 100);
        if (r.commission_amount != null && Number.isFinite(c) && c > 0) {
          saleCut = saleSvc > 0 && service < saleSvc ? Math.round(c * 100 * service / saleSvc) / 100 : c;
          break;
        }
      }
    } catch { /* derived from the rate instead */ }
  }

  const row: Record<string, unknown> = {
    ...(key ? { id: refundRecordId(key) } : {}),
    shop_id: args.shopId,
    barber_id: args.barberId ?? null,
    client_name: args.clientName ?? null,
    service_name: args.serviceName ? `Refund — ${args.serviceName}` : "Refund",
    amount: -(service / 100), tip: -(tip / 100), tax: -(tax / 100),
    // `type` is CHECK-constrained to service|product|tip; a refund record is
    // identified by source "refund" (every report excludes it by that).
    payment_method: method, type: "service", source: "refund",
    appointment_id: args.appointmentId ?? null,
    payment_intent_id: args.paymentIntentId ?? null,
    refunded: true, stripe_fee: 0,
    ...(saleCut != null ? { commission_amount: -saleCut } : {}),
    ...(args.refundedAt ? { created_at: args.refundedAt } : {}),
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
  if (key && e.code === "23505" && /transactions_pkey/.test(String(e.message ?? ""))) {
    const { data: winner } = await supabaseAdmin.from("transactions")
      .select("id, shop_id, source, payment_intent_id").eq("id", refundRecordId(key)).maybeSingle()
      .then(r => r, () => ({ data: null }));
    if (winner && winner.source === "refund" && (winner.payment_intent_id ?? null) === (args.paymentIntentId ?? null) && winner.shop_id === args.shopId) return "already";
  }
  await logLedgerSaveFailure("refund-ledger", { shopId: args.shopId, appointmentId: args.appointmentId, paymentIntentId: args.paymentIntentId }, saveError);
  return "failed";
}
