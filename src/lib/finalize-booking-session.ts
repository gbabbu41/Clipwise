import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSmsBestEffort } from "@/lib/twilio";
import { isDoubleBookError, barberHasConflict } from "@/lib/booking-conflict";
import { scheduleBlockReason } from "@/lib/schedule-block";
import { recordOnlinePaymentTx } from "@/lib/finalize-appointment-payment";
import { insertNotifications } from "@/lib/notify-server";
import { timeToMinutes, prettyDate } from "@/lib/utils";
import { fetchValidPromo, consumePromo } from "@/lib/promo";
import { deductRedeemedPoints } from "@/lib/loyalty-redeem";
import { redeemGift } from "@/lib/gift-redeem";
import { ensureClientRow } from "@/lib/ensure-client";

export type BookingSummary = {
  shopName: string;
  barberName: string;
  serviceName: string;
  date: string;
  time: string;
  total: number;   // service + tax (the stored appointment total, excl. tip)
  tip: number;     // tip the customer added (0 if none) — shown as its own line
  clientEmail: string;
  paymentNote: string;
};

export type FinalizeResult =
  | { status: "not_ready" }                                        // payment not settled yet
  | { status: "exists"; appointmentId: string; summary: BookingSummary | null } // idempotent hit
  | { status: "conflict"; message: string }                        // slot lost / schedule blocked (money reversed)
  | { status: "error"; message: string }
  | { status: "created"; appointmentId: string; summary: BookingSummary };

/**
 * Turn a COMPLETED Stripe Checkout session into a confirmed appointment —
 * verifying payment, deduping, re-checking the slot/schedule, then creating the
 * row + all side effects (ledger, notifications, SMS, emails). This is the
 * single source of truth for finalizing a paid booking, called from BOTH:
 *   · /api/stripe/booking-finalize — the customer's return from Checkout, and
 *   · /api/webhooks/stripe (checkout.session.completed) — the fallback for when
 *     the customer closes the tab before returning (otherwise their charge would
 *     succeed with no appointment ever created).
 *
 * Fully idempotent: whichever path arrives second dedupes on the PaymentIntent
 * (or saved card + slot) and returns the existing appointment WITHOUT reversing
 * any money — the same-session race (client + webhook both firing) must never be
 * mistaken for a lost slot.
 */
export async function finalizeBookingFromSession(params: {
  session: Stripe.Checkout.Session;
  useConnect: boolean;
  stripeAccountId: string | null;
  baseUrl: string;
}): Promise<FinalizeResult> {
  const { session, useConnect, stripeAccountId, baseUrl } = params;
  const acctOpts = useConnect && stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
  const m = session.metadata ?? {};
  const isHold = m.hold === "1";
  const isSave = m.save === "1";

  // ── Confirm the money actually settled ─────────────────────────────────────
  let savedCustomerId: string | null = null;
  let savedPaymentMethodId: string | null = null;
  if (isSave) {
    // Saved-card path (>7-day booking): `setup` mode, no charge. Confirm the
    // SetupIntent succeeded + grab the customer/card to charge later.
    const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : null;
    if (!setupIntentId) return { status: "not_ready" };
    const si = await stripe.setupIntents.retrieve(setupIntentId, undefined, acctOpts);
    if (si.status !== "succeeded") return { status: "not_ready" };
    savedCustomerId = typeof si.customer === "string" ? si.customer : null;
    savedPaymentMethodId = typeof si.payment_method === "string" ? si.payment_method : null;
    if (!savedPaymentMethodId) return { status: "not_ready" };
  } else if (isHold) {
    // Hold leaves the session "unpaid" until capture — confirm the PI authorized.
    if (!paymentIntentId) return { status: "not_ready" };
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, undefined, acctOpts);
    if (pi.status !== "requires_capture") return { status: "not_ready" };
  } else if (session.payment_status !== "paid") {
    return { status: "not_ready" };
  }

  // Dedup: has THIS checkout already produced an appointment? Paid/held rows key
  // on the PaymentIntent; saved-card rows (no PI yet) key on the saved card + slot.
  const findMine = async (): Promise<string | null> => {
    if (paymentIntentId) {
      const { data } = await supabaseAdmin
        .from("appointments").select("id").eq("payment_intent_id", paymentIntentId).maybeSingle();
      return data?.id ?? null;
    }
    if (isSave && savedPaymentMethodId) {
      const { data } = await supabaseAdmin
        .from("appointments").select("id")
        .eq("stripe_payment_method_id", savedPaymentMethodId)
        .eq("date", m.date).eq("time_slot", m.time_slot).maybeSingle();
      return data?.id ?? null;
    }
    return null;
  };

  const existingId = await findMine();
  if (existingId) return { status: "exists", appointmentId: existingId, summary: await buildSummary(existingId, isSave, isHold) };

  // Best-effort money reversal when we must refuse AFTER the customer paid.
  const reverseMoney = async () => {
    try {
      if (isHold && paymentIntentId) {
        await stripe.paymentIntents.cancel(paymentIntentId, undefined, acctOpts);
      } else if (!isHold && !isSave && paymentIntentId) {
        await stripe.refunds.create({ payment_intent: paymentIntentId }, acctOpts);
      }
    } catch { /* best-effort — surface the reason regardless */ }
  };

  if (m.barber_id) {
    const { data: fSvc } = await supabaseAdmin
      .from("services").select("duration_minutes").eq("id", m.service_id).maybeSingle();
    const fStart = timeToMinutes(m.time_slot);
    const mDuration = Number(m.duration_minutes ?? 0) > 0 ? Number(m.duration_minutes) : (fSvc?.duration_minutes ?? 30);
    const fEnd = fStart + mDuration;

    if (await barberHasConflict(m.barber_id, m.date, fStart, fEnd)) {
      // The conflicting row might be MY OWN booking created by the concurrent
      // path (client + webhook) — that's not a lost slot, so return it, no refund.
      const mine = await findMine();
      if (mine) return { status: "exists", appointmentId: mine, summary: await buildSummary(mine, isSave, isHold) };
      await reverseMoney();
      return { status: "conflict", message: isSave
        ? "That time was just booked by someone else. Please pick another slot."
        : "That time was just booked by someone else. Your payment was reversed — please pick another slot." };
    }

    const blockReason = await scheduleBlockReason(m.shop_id, m.barber_id, m.date, fStart, fEnd, { includeBreaks: true });
    if (blockReason) {
      const mine = await findMine();
      if (mine) return { status: "exists", appointmentId: mine, summary: await buildSummary(mine, isSave, isHold) };
      await reverseMoney();
      return { status: "conflict", message: isSave ? blockReason : `${blockReason} Your payment was reversed.` };
    }
  }

  const baseRow = {
    shop_id: m.shop_id,
    barber_id: m.barber_id || null,
    service_id: m.service_id,
    client_name: m.client_name,
    client_email: m.client_email,
    client_phone: m.client_phone,
    date: m.date,
    time_slot: m.time_slot,
    status: "confirmed",
    total_amount: Number(m.total_amount ?? 0),
    ...(Number(m.duration_minutes ?? 0) > 0 ? { duration_minutes: Number(m.duration_minutes) } : {}),
    ...(m.service_names ? { notes: `Services: ${m.service_names}` } : {}),
    deposit_paid: !isHold && !isSave,
    payment_status: isSave ? "saved" : isHold ? "held" : "paid",
    ...(!isSave && !isHold ? { paid_at: new Date().toISOString() } : {}),
    payment_intent_id: paymentIntentId,
    stripe_customer_id: savedCustomerId,
    stripe_payment_method_id: savedPaymentMethodId,
  };
  // Include tip/tax when phase30 columns exist; if they don't yet, retry without
  // them so a booking is NEVER lost after the customer has paid.
  let ins = await supabaseAdmin.from("appointments")
    .insert({ ...baseRow, tip_amount: Number(m.tip_amount ?? 0), tax_amount: Number(m.tax_amount ?? 0) })
    .select("id").single();
  if (ins.error && /(tip_amount|tax_amount)/.test(ins.error.message) && /column|does not exist|schema cache/i.test(ins.error.message)) {
    ins = await supabaseAdmin.from("appointments").insert(baseRow).select("id").single();
  }
  const { data: appt, error } = ins;

  if (error) {
    // Slot taken in the race window (DB rejected — unique index OR overlap guard).
    if (isDoubleBookError(error)) {
      // Was it MY OWN booking (concurrent client + webhook)? Then it's not a lost
      // slot — return it without touching the money.
      const mine = await findMine();
      if (mine) return { status: "exists", appointmentId: mine, summary: await buildSummary(mine, isSave, isHold) };
      await reverseMoney();
      return { status: "conflict", message: isSave
        ? "That time was just booked by someone else. Please pick another slot."
        : "That time was just booked by someone else. Your payment was reversed — please pick another slot." };
    }
    return { status: "error", message: error.message };
  }

  // Consume the promo now that the appointment exists (draws down the cap +
  // records the redemption). Best-effort; already validated in booking-checkout.
  if (m.promo_code) {
    const promo = await fetchValidPromo(m.shop_id, m.promo_code);
    if (promo) await consumePromo(promo, m.shop_id, m.client_email ?? null, m.client_phone ?? null, appt.id);
  }

  // Register/resolve the client (deduped email → phone) and stamp the
  // appointment with a permanent client_id link (phase 36). The update is
  // best-effort so it's a no-op if that column isn't there yet.
  const linkedClientId = await ensureClientRow(m.shop_id, { name: m.client_name, email: m.client_email, phone: m.client_phone });
  if (linkedClientId) {
    await supabaseAdmin.from("appointments").update({ client_id: linkedClientId }).eq("id", appt.id).then(null, () => null);
  }

  // Spend redeemed loyalty points now that the appointment exists + payment
  // settled. The discount was already applied to the charged total in
  // booking-checkout; this draws the points down. Runs once (the dedup guard
  // above returns early on a repeat finalize). Best-effort.
  if (Number(m.redeem_points ?? 0) > 0) {
    await deductRedeemedPoints({
      shopId: m.shop_id, email: m.client_email, phone: m.client_phone,
      points: Number(m.redeem_points), appointmentId: appt.id,
    });
  }

  // Draw down a gift card applied to this booking (the discount was already
  // taken off the Stripe charge). Runs once via the dedup guard. Best-effort.
  if (Number(m.gift_applied ?? 0) > 0 && m.gift_code) {
    await redeemGift(m.shop_id, m.gift_code, Number(m.gift_applied));
  }

  const { data: shopRow } = await supabaseAdmin.from("shops").select("owner_id, name, email, slug").eq("id", m.shop_id).single();
  const friendly = prettyDate(m.date);
  if (shopRow?.owner_id) {
    // Show what the customer actually paid (service + tax + tip), so the alert
    // matches the Stripe charge rather than under-reporting by the tip.
    const amountStr = `$${(Number(m.total_amount ?? 0) + Number(m.tip_amount ?? 0)).toFixed(0)}`;
    const bookingTitle = isSave ? `New Booking · card on file · ${amountStr}`
      : isHold ? `New Booking · card held · ${amountStr}`
      : `New Paid Booking · ${amountStr}`;
    const bookingVerb = isSave ? "(card saved)" : isHold ? "(card on hold)" : "& paid";
    insertNotifications({
      user_id: shopRow.owner_id,
      shop_id: m.shop_id,
      title: bookingTitle,
      message: `${m.client_name} booked ${bookingVerb} for ${friendly} at ${m.time_slot}`,
      type: "booking",
      entity_type: "appointment",
      entity_id: appt.id,
    });
  }

  // Barber in-app notification + SMS to owner & barber.
  fetch(`${baseUrl}/api/appointments/notify-staff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appointment_id: appt.id, notify_owner: false }),
  }).catch(() => null);

  // Text the customer a confirmation (best-effort).
  {
    const payNote = isSave ? " Card saved — charged after your visit."
      : isHold ? " Card held — charged after your visit."
      : " Paid online.";
    sendSmsBestEffort(
      m.client_phone,
      `Your appointment on ${friendly} at ${m.time_slot} is confirmed.${payNote} Booking #${appt.id.slice(0, 8).toUpperCase()}. Manage: ${baseUrl}/my-booking/${appt.id}`,
      shopRow?.name,
    );
  }

  // Ledger + confirmation emails (customer + owner + barber). Never block on these.
  let summaryBarberName = "Any Available";
  let summaryServiceName = "Service";
  try {
    const [{ data: barber }, { data: service }] = await Promise.all([
      m.barber_id
        ? supabaseAdmin.from("barbers").select("name, email").eq("id", m.barber_id).maybeSingle()
        : Promise.resolve({ data: null as { name: string; email: string | null } | null }),
      m.service_id
        ? supabaseAdmin.from("services").select("name").eq("id", m.service_id).maybeSingle()
        : Promise.resolve({ data: null as { name: string } | null }),
    ]);
    summaryBarberName = barber?.name ?? "Any Available";
    summaryServiceName = service?.name ?? "Service";
    // A pay-now booking is an online payment — ledger it (held/saved charge later).
    if (!isSave && !isHold && paymentIntentId) {
      const taxDollars = Number(m.tax_amount ?? 0);
      const tipDollars = Number(m.tip_amount ?? 0);
      // Record only REAL money as revenue. A gift card was pre-paid (and already
      // counted as income when it was sold), so subtract the gift portion here to
      // avoid double-counting the same dollars.
      const giftApplied = Number(m.gift_applied ?? 0);
      await recordOnlinePaymentTx({
        appointmentId: appt.id,
        shopId: m.shop_id,
        barberId: m.barber_id || null,
        clientName: m.client_name ?? null,
        serviceName: summaryServiceName,
        amountDollars: Math.max(0, Number(m.total_amount ?? 0) - taxDollars - giftApplied),
        taxDollars,
        tipDollars,
        paymentIntentId,
      });
    }
    const bookingData = {
      clientName: m.client_name, clientEmail: m.client_email || "—", clientPhone: m.client_phone || "—",
      shopId: m.shop_id, shopName: shopRow?.name ?? "", shopEmail: shopRow?.email ?? "", shopSlug: shopRow?.slug ?? "",
      barberName: barber?.name ?? "Any Available",
      serviceName: service?.name ?? "Service",
      date: m.date, time: m.time_slot,
      // Grand total the customer paid — service + tax + tip (matches the charge).
      total: `$${(Number(m.total_amount ?? 0) + Number(m.tip_amount ?? 0)).toFixed(2)}`,
      paymentNote: isSave ? "Card saved — charged after your visit"
        : isHold ? "Card on hold — charged after your visit"
        : "Paid online",
      bookingId: appt.id.slice(0, 8).toUpperCase(), appointmentId: appt.id,
    };
    const send = (type: string, extra: Record<string, unknown>) =>
      fetch(`${baseUrl}/api/send-email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, data: { ...bookingData, ...extra } }),
      }).catch(() => null);
    if (m.client_email) send("booking_confirmation", { clientEmail: m.client_email });
    if (shopRow?.email) send("new_booking_owner", { ownerEmail: shopRow.email });
    if (barber?.email) send("new_booking_barber", { barberEmail: barber.email, barberName: barber.name });
  } catch { /* never block the booking on email */ }

  return {
    status: "created",
    appointmentId: appt.id,
    summary: {
      shopName: shopRow?.name ?? "",
      barberName: summaryBarberName,
      serviceName: summaryServiceName,
      date: m.date,
      time: m.time_slot,
      total: Number(m.total_amount ?? 0),
      tip: Number(m.tip_amount ?? 0),
      clientEmail: m.client_email ?? "",
      paymentNote: isSave ? "Card saved — charged after your visit"
        : isHold ? "Card held — charged after your visit"
        : "Paid online",
    },
  };
}

/** Rebuild the confirmation-screen summary from a stored appointment — used when
 *  the row already exists (the other path, or the webhook, created it first) so
 *  the customer's success screen still shows real details, not blanks. */
async function buildSummary(appointmentId: string, isSave: boolean, isHold: boolean): Promise<BookingSummary | null> {
  const { data: a } = await supabaseAdmin
    .from("appointments")
    .select("date, time_slot, total_amount, tip_amount, client_email, payment_status, shops(name), barbers(name), services(name)")
    .eq("id", appointmentId).maybeSingle();
  if (!a) return null;
  const rel = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const shop = rel(a.shops as { name?: string } | { name?: string }[] | null);
  const barber = rel(a.barbers as { name?: string } | { name?: string }[] | null);
  const service = rel(a.services as { name?: string } | { name?: string }[] | null);
  const saved = isSave || a.payment_status === "saved";
  const held = isHold || a.payment_status === "held";
  return {
    shopName: shop?.name ?? "",
    barberName: barber?.name ?? "Any Available",
    serviceName: service?.name ?? "Service",
    date: a.date as string,
    time: a.time_slot as string,
    total: Number(a.total_amount ?? 0),
    tip: Number(a.tip_amount ?? 0),
    clientEmail: (a.client_email as string) ?? "",
    paymentNote: saved ? "Card saved — charged after your visit"
      : held ? "Card held — charged after your visit"
      : "Paid online",
  };
}
