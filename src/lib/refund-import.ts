import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordRefundLedger, refundRecordId } from "@/lib/refund-ledger";

// Refunds made straight in Stripe (its dashboard) — imported into our ledger ONE
// Stripe refund at a time, each with its own amount and its own date (owner
// decision 2026-10-03). A charge can be refunded in parts: $10 on Monday and the
// other $30 on Friday must land as −$10 Monday and −$30 Friday — not −$40 Friday,
// and never nothing at all if only the $10 ever happens.
//
// Each refund record is keyed by Stripe's refund id (lib/refund-ledger), so the
// in-app refund route and the charge.refunded webhook can never record the same
// refund twice, and a redelivered event changes nothing.

export type StripeRefundLite = { id: string; amount: number; created: number; status?: string | null };
export type RecordedRefund = { id: string; cents: number };
export type RefundToImport = { refundId: string; cents: number; created: number };

/** Which of a charge's Stripe refunds still need their refund record. Pure.
 *  `recorded` = this charge's existing refund records (chargebacks excluded).
 *  A record keyed by a refund's id matches that refund exactly; older records
 *  keyed by the charge (written before refunds were imported one by one) cover
 *  the earliest refunds by amount, so nothing they already recorded is added
 *  again. Failed / cancelled refunds moved no money and are skipped. */
export function refundsToImport(
  stripeRefunds: StripeRefundLite[], recorded: RecordedRefund[], idFor: (refundId: string) => string = refundRecordId,
): RefundToImport[] {
  const live = stripeRefunds
    .filter(r => r.amount > 0 && (r.status == null || r.status === "succeeded" || r.status === "pending"))
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  const recordedIds = new Set(recorded.map(r => r.id));
  const matched = new Set<string>();
  const unmatched: StripeRefundLite[] = [];
  for (const r of live) {
    const id = idFor(r.id);
    if (recordedIds.has(id)) matched.add(id); else unmatched.push(r);
  }
  // Older records not tied to one refund: what they cover is already counted.
  let covered = recorded.filter(r => !matched.has(r.id)).reduce((s, r) => s + Math.max(0, r.cents), 0);
  const out: RefundToImport[] = [];
  for (const r of unmatched) {
    const take = Math.min(covered, r.amount);
    covered -= take;
    if (r.amount - take > 0) out.push({ refundId: r.id, cents: r.amount - take, created: r.created });
  }
  return out;
}

const cents = (v: unknown) => Math.round((Number(v) || 0) * 100);
const isChargeback = (name: unknown) => /chargeback/i.test(String(name ?? ""));

/**
 * Bring one charge's refunds into the ledger (charge.refunded webhook — fires for
 * full AND partial refunds). Records every Stripe refund not yet recorded, dated
 * when Stripe made it. Only a FULL refund marks the booking / sale refunded; a
 * partial one leaves it paid (points, gift card and booking untouched) while the
 * refunded amount still comes off the money and the barber's cut on its own day.
 */
export async function importChargeRefunds(args: {
  chargeId: string;
  paymentIntentId: string;
  account: string | null;
  fullyRefunded: boolean;
  amountRefunded: number;   // cents, Stripe's running total for the charge
  eventCreated: number;     // unix seconds — the date if Stripe can't list the refunds
}): Promise<{ recorded: RefundToImport[]; appointment: SaleAppt | null; sale: SaleTx | null; flipped: boolean }> {
  const pi = args.paymentIntentId;

  // Stripe's own list of this charge's refunds. If it can't be read, fall back to
  // its running total (one record per distinct total — still never doubled).
  let list: StripeRefundLite[];
  try {
    const res = await stripe.refunds.list({ charge: args.chargeId, limit: 100 }, args.account ? { stripeAccount: args.account } : undefined);
    list = res.data.map(r => ({ id: r.id, amount: r.amount, created: r.created, status: r.status }));
  } catch {
    list = args.amountRefunded > 0 ? [{ id: `${args.chargeId}:refunded:${args.amountRefunded}`, amount: args.amountRefunded, created: args.eventCreated, status: "succeeded" }] : [];
  }

  // What was sold on this charge — the booking, else its ledger row.
  const { data: apptRow } = await supabaseAdmin.from("appointments")
    .select("id, shop_id, barber_id, client_name, total_amount, tax_amount, tip_amount, date, status, payment_status, services(name)")
    .eq("payment_intent_id", pi).maybeSingle();
  const appointment = (apptRow as SaleAppt | null) ?? null;
  const { data: txRow } = await supabaseAdmin.from("transactions")
    .select("shop_id, barber_id, client_name, service_name, amount, tax, tip, appointment_id")
    .eq("payment_intent_id", pi).neq("source", "refund").limit(1).maybeSingle();
  const sale = (txRow as SaleTx | null) ?? null;

  // A no-show's charge is its fee row; a booking otherwise splits by the booking.
  const byAppt = !!appointment && appointment.status !== "no-show";
  const shopId = byAppt ? appointment!.shop_id : sale?.shop_id ?? appointment?.shop_id ?? null;
  const recordedOut: RefundToImport[] = [];
  if (shopId) {
    const { data: recRows } = await supabaseAdmin.from("transactions")
      .select("id, amount, tax, tip, service_name").eq("source", "refund").eq("payment_intent_id", pi);
    const recorded = ((recRows ?? []) as { id: string; amount: unknown; tax: unknown; tip: unknown; service_name: unknown }[])
      .filter(r => !isChargeback(r.service_name))
      .map(r => ({ id: r.id, cents: Math.abs(cents(r.amount) + cents(r.tax) + cents(r.tip)) }));

    const chargeCents = byAppt
      ? cents(appointment!.total_amount) + cents(appointment!.tip_amount)
      : cents(sale?.amount) + cents(sale?.tax) + cents(sale?.tip);
    const taxOf = byAppt ? cents(appointment!.tax_amount) : cents(sale?.tax);
    const tipOf = byAppt ? cents(appointment!.tip_amount) : cents(sale?.tip);
    const svc = appointment?.services;
    const serviceName = byAppt
      ? (Array.isArray(svc) ? svc[0]?.name ?? null : svc?.name ?? null)
      : (sale?.service_name ?? null);

    for (const r of refundsToImport(list, recorded)) {
      const res = await recordRefundLedger({
        shopId, barberId: (byAppt ? appointment!.barber_id : sale?.barber_id) ?? null,
        clientName: (byAppt ? appointment!.client_name : sale?.client_name) ?? null,
        serviceName,
        refundedCents: r.cents,
        taxCents: chargeCents > 0 ? Math.round(r.cents * taxOf / chargeCents) : 0,
        tipCents: chargeCents > 0 ? Math.round(r.cents * tipOf / chargeCents) : 0,
        appointmentId: appointment?.id ?? sale?.appointment_id ?? null,
        paymentIntentId: pi,
        stripeRefundId: r.refundId,
        refundedAt: new Date(r.created * 1000).toISOString(),
      });
      if (res === "recorded") recordedOut.push(r);
    }
  }

  // Fully refunded → the sale is refunded (loyalty / gift card reverse in the DB).
  let flipped = false;
  if (args.fullyRefunded) {
    const { data: f } = await supabaseAdmin.from("appointments")
      .update({ payment_status: "refunded" })
      .eq("payment_intent_id", pi).neq("payment_status", "refunded").select("id");
    flipped = Array.isArray(f) && f.length > 0;
    await supabaseAdmin.from("transactions").update({ refunded: true })
      .eq("payment_intent_id", pi).neq("source", "refund");
  }
  return { recorded: recordedOut, appointment, sale, flipped };
}

export type SaleAppt = {
  id: string; shop_id: string; barber_id: string | null; client_name: string | null;
  total_amount: number | null; tax_amount: number | null; tip_amount: number | null;
  date: string | null; status: string | null; payment_status: string | null;
  services: { name?: string } | { name?: string }[] | null;
};
export type SaleTx = {
  shop_id: string; barber_id: string | null; client_name: string | null; service_name: string | null;
  amount: number | null; tax: number | null; tip: number | null; appointment_id: string | null;
};
