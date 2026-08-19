// Server-only — shared "mark an appointment paid (via online link/checkout)"
// used by payment-link-finalize (customer returns) and reconcile-payments
// (owner-side catch-up). Flips unpaid→paid idempotently and fires the receipt +
// owner/barber alerts ONLY on the real transition, so it can't double-notify.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPaymentReceipt, notifyNoShowCharged } from "@/lib/payment-notify";
import { stripeFeeCents } from "@/lib/stripe";
import { runServerCompletionEffects } from "@/lib/completion-server";
import type { TaxConfig } from "@/lib/pricing";

export interface PayableAppt {
  id: string;
  shop_id?: string | null;
  barber_id: string | null;
  client_name: string | null;
  client_email: string | null;
  date: string;
  time_slot: string;
  total_amount: number | null;   // GROSS (tax-inclusive)
  tax_amount?: number | null;    // the tax portion of total_amount (0 if none)
  status?: string | null;
  services?: { name?: string } | { name?: string }[] | null;
}
export interface PayShop {
  name: string | null;
  email: string | null;
  owner_id: string | null;
  booking_settings?: TaxConfig | null; // → receipt-style tax label (optional)
}

export function serviceNameOf(rel: PayableAppt["services"]): string {
  return Array.isArray(rel) ? (rel[0]?.name ?? "Service") : (rel?.name ?? "Service");
}

/**
 * Record a transactions-ledger row for an ONLINE (link/checkout) payment, so it
 * shows up wherever the ledger is read — the barber Payments page and analytics —
 * the same way POS / no-show / completion charges already do. Without this an
 * online payment only flips appointments.payment_status and is invisible to the
 * barber portal (it reads `transactions` only), while the owner Payments page
 * still shows it (it reads `appointments` too). Attributed to the appointment's
 * barber. Idempotent (a payment can be finalized by both the customer-return
 * route AND the webhook) and best-effort — bookkeeping never blocks a payment.
 *
 * Tagged source="completion" (the same bucket capture-appointment uses for a
 * card charge that's already represented by its appointment row) so the owner
 * Payments feed de-dupes it for free — only the barber page / analytics, which
 * read every ledger row, surface it.
 */
export async function recordOnlinePaymentTx(args: {
  appointmentId: string;
  shopId: string | null | undefined;
  barberId: string | null;
  clientName: string | null;
  serviceName: string;
  amountDollars: number;      // service revenue, net of tax + tip
  paymentIntentId: string | null;
  tipDollars?: number;        // tip collected (0 if none)
  taxDollars?: number;        // sales tax collected (0 if none)
}): Promise<void> {
  const { appointmentId, shopId, barberId, clientName, serviceName, amountDollars, paymentIntentId } = args;
  const tipDollars = Math.max(0, Number(args.tipDollars ?? 0));
  const taxDollars = Math.max(0, Number(args.taxDollars ?? 0));
  if (!shopId || (amountDollars <= 0 && tipDollars <= 0)) return;
  // Dedup: prefer the PaymentIntent as the key (shared across return-route +
  // webhook); fall back to this appointment's existing row. If one is already
  // there, this is a no-op.
  const dupe = paymentIntentId
    ? await supabaseAdmin.from("transactions").select("id").eq("payment_intent_id", paymentIntentId).limit(1)
    : await supabaseAdmin.from("transactions").select("id").eq("appointment_id", appointmentId).eq("source", "completion").limit(1);
  if ((dupe.data?.length ?? 0) > 0) return;
  // Real Stripe processing fee for this card payment (split 50/50 barber/shop at
  // read time). Read from the charge's balance_transaction on the shop's
  // connected account. Best-effort — a fee-lookup miss just stores 0.
  let feeDollars = 0;
  if (paymentIntentId) {
    const { data: sh } = await supabaseAdmin
      .from("shops").select("stripe_account_id, stripe_connected").eq("id", shopId).maybeSingle();
    const acct = sh?.stripe_account_id && sh?.stripe_connected ? sh.stripe_account_id : null;
    feeDollars = (await stripeFeeCents(paymentIntentId, acct)) / 100;
  }
  const base = {
    shop_id: shopId,
    barber_id: barberId || null,
    client_name: clientName || null,
    service_name: serviceName || "Service",
    amount: amountDollars,
    tip: tipDollars,
    payment_method: "card",
    type: "service",
    appointment_id: appointmentId,
    payment_intent_id: paymentIntentId ?? null,
    source: "completion",
  };
  // `tax` (phase30) + `stripe_fee` (phase38) may lag on prod until the migration
  // runs — drop the missing column(s) and retry so the revenue row is never lost.
  const full = { ...base, tax: taxDollars, stripe_fee: feeDollars };
  const res = await supabaseAdmin.from("transactions").insert(full);
  if (res.error && /column|does not exist|schema cache/i.test(res.error.message)) {
    const res2 = await supabaseAdmin.from("transactions").insert({ ...base, tax: taxDollars });
    if (res2.error && /column|does not exist|schema cache/i.test(res2.error.message)) {
      await supabaseAdmin.from("transactions").insert(base).then(null, () => null);
    }
  }
}

/**
 * Flip an appointment unpaid→paid (idempotent via a conditional update). Returns
 * true only when THIS call performed the transition — in which case it also
 * sends the customer receipt, the owner+barber in-app "Payment collected"
 * pop-up, and the owner "payment received" email.
 */
export async function markAppointmentPaid(args: {
  appt: PayableAppt;
  shop: PayShop;
  baseUrl: string;
  paymentIntentId?: string | null;
  /**
   * Checkout flow: the barber hit "Check out" → "Send payment link", so paying
   * it should finish the visit. Flip straight to "completed". Omitted/false for
   * a plain pay-in-person link or booking-time prepay, which only become
   * "confirmed" (still need an in-person check-out to complete).
   */
  completeOnPaid?: boolean;
}): Promise<boolean> {
  const { appt, shop, baseUrl, paymentIntentId, completeOnPaid } = args;

  const { data: claimed } = await supabaseAdmin
    .from("appointments")
    .update({
      payment_status: "paid",
      payment_method: "online",
      paid_at: new Date().toISOString(),
      // Checkout-link payment finishes the visit → completed. Otherwise a
      // pending pay-in-person booking that gets paid is now confirmed (no
      // separate manual approval needed once money is in).
      ...(completeOnPaid ? { status: "completed" } : appt.status === "pending" ? { status: "confirmed" } : {}),
      ...(paymentIntentId ? { payment_intent_id: paymentIntentId } : {}),
    })
    .eq("id", appt.id)
    // Only ever promote a genuinely-unpaid booking. Using .neq("paid") let a
    // REFUNDED or CAPTURED (no-show) row get flipped to paid + re-notified — e.g.
    // reconcile-payments re-checking Stripe after a refund would revert it and
    // fire a bogus "Payment collected". Restrict to real unpaid states so a
    // refunded/captured/paid row is never touched (matches the webhook filter).
    .in("payment_status", ["unpaid", "held", "saved", "failed"])
    .select("id");

  if ((claimed?.length ?? 0) === 0) return false;

  const serviceName = serviceNameOf(appt.services);
  const amountCents = Math.round(Number(appt.total_amount ?? 0) * 100); // gross paid
  const taxDollars = Math.max(0, Number(appt.tax_amount ?? 0));

  // Put the online payment in the ledger so the barber portal + analytics see it.
  // amount is PRE-TAX service revenue (gross − tax); tax is recorded separately so
  // the receipt shows the breakdown and pre-tax revenue isn't overstated.
  await recordOnlinePaymentTx({
    appointmentId: appt.id,
    shopId: appt.shop_id,
    barberId: appt.barber_id,
    clientName: appt.client_name,
    serviceName,
    amountDollars: Math.max(0, amountCents / 100 - taxDollars),
    taxDollars,
    paymentIntentId: paymentIntentId ?? null,
  });

  sendPaymentReceipt(baseUrl, {
    clientEmail: appt.client_email,
    clientName: appt.client_name,
    shopName: shop.name,
    shopEmail: shop.email,
    serviceName,
    date: appt.date,
    amountCents,
    context: "Payment received",
    // Itemize price + tax (online payment = gross; subtotal = gross − tax).
    taxCents: Math.round(taxDollars * 100),
    taxConfig: shop.booking_settings ?? null,
    time: appt.time_slot,
    durationMinutes: (appt as { duration_minutes?: number | null }).duration_minutes ?? null,
    timezone: (shop as { timezone?: string | null }).timezone ?? null,
  });

  notifyNoShowCharged({
    ownerId: shop.owner_id,
    barberId: appt.barber_id,
    shopId: appt.shop_id,
    clientName: appt.client_name,
    amountCents,
    date: appt.date,
    kind: "completed",
  });

  if (shop.email) {
    fetch(`${baseUrl}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "owner_payment_received",
        data: {
          ownerEmail: shop.email,
          clientName: appt.client_name ?? "A client",
          serviceName,
          amount: `$${(amountCents / 100).toFixed(2)}`,
          date: appt.date,
          time: appt.time_slot,
        },
      }),
    }).catch(() => null);
  }

  // Checkout-link payment finished the visit → run the same completion effects a
  // manual "Complete" does (loyalty + client stats + review email). The atomic
  // claim above means this runs at most once. Skipped for a plain confirm-on-pay.
  if (completeOnPaid) {
    await runServerCompletionEffects({ appointmentId: appt.id, baseUrl }).catch(() => null);
  }

  return true;
}
