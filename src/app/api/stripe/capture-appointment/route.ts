import { NextRequest, NextResponse } from "next/server";
import { stripe, stripeFeeCents } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPaymentReceipt, notifyChargeFailed, notifyNoShowCharged } from "@/lib/payment-notify";
import { sendSmsBestEffort } from "@/lib/twilio";
import { prettyDate, isCheckoutAllowed, CHECKOUT_LEAD_HOURS } from "@/lib/utils";
import { safeTz, todayInTz, nowMinutesInTz } from "@/lib/timezone";
import { noShowFeeCents, NO_SHOW_MAX_PCT } from "@/lib/validation";
import type { TaxConfig } from "@/lib/pricing";

/**
 * Capture a previously-authorized (held) PaymentIntent for an appointment.
 *  - reason "completed": capture the full held amount when the service is done.
 *  - reason "no_show":  capture a no-show fee (amount_cents) or the full hold.
 *
 * Reuses the existing Connect setup ({ stripeAccount }) with platform fallback.
 * Never throws to the UI; on failure the appointment is flagged
 * payment_status = "failed" for manual review.
 */
export async function POST(request: NextRequest) {
  const { appointment_id, reason, amount_cents } = await request.json() as {
    appointment_id?: string;
    reason?: "completed" | "no_show";
    amount_cents?: number;
  };
  if (!appointment_id) {
    return NextResponse.json({ ok: false, error: "Missing appointment_id" }, { status: 400 });
  }

  // ── Auth: caller must be the shop owner ───────────────────────────────────
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data: userData } = await supabaseAdmin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  console.log("[capture-appointment] start", { appointment_id, reason });

  const { data: appt, error: apptErr } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, service_id, client_name, client_email, client_phone, date, time_slot, total_amount, tip_amount, tax_amount, payment_intent_id, payment_status, stripe_customer_id, stripe_payment_method_id")
    .eq("id", appointment_id).maybeSingle();
  if (apptErr || !appt) {
    console.warn("[capture-appointment] appointment NOT FOUND", { appointment_id, apptErr: apptErr?.message });
    return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
  }

  const { data: shop, error: shopErr } = await supabaseAdmin
    .from("shops").select("owner_id, name, email, stripe_account_id, stripe_connected, booking_settings, timezone").eq("id", appt.shop_id).maybeSingle();
  if (shopErr || !shop) {
    console.warn("[capture-appointment] shop NOT FOUND", { appointment_id, shop_id: appt.shop_id, shopErr: shopErr?.message });
    return NextResponse.json({ ok: false, error: "Shop not found" }, { status: 404 });
  }
  // Allow the shop OWNER, or a BARBER of this shop who's been granted the
  // manage_appointments permission (the same gate that shows the action buttons
  // in their portal). Otherwise forbidden.
  let allowed = shop.owner_id === userId;
  if (!allowed) {
    const { data: barber } = await supabaseAdmin
      .from("barbers").select("is_active, permissions").eq("shop_id", appt.shop_id).eq("user_id", userId).maybeSingle();
    const perms = barber?.permissions as { manage_appointments?: boolean } | null;
    allowed = !!barber?.is_active && perms?.manage_appointments === true;
  }
  console.log("[capture-appointment] found", { appointment_id, payment_status: appt.payment_status, allowed });
  if (!allowed) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  // Check-out window: a completion charge is only allowed from CHECKOUT_LEAD_HOURS
  // before the appointment (any time after is fine). Blocks charging a booking
  // days early. A no-show fee is exempt (it's charged at/after the missed slot).
  if (reason === "completed") {
    const tz = safeTz((shop as { timezone?: string | null }).timezone);
    if (!isCheckoutAllowed(appt.date, appt.time_slot, todayInTz(tz), nowMinutesInTz(tz))) {
      return NextResponse.json({ ok: false, error: `Too early — check out is allowed from ${CHECKOUT_LEAD_HOURS} hours before the appointment.` }, { status: 400 });
    }
  }

  // "saved" path = charge a stored card off-session (nothing was held). Also
  // covers a RETRY after a failed charge: payment_status flips to "failed" but
  // the stored payment method is still on file and no intent was held, so we
  // re-charge the saved card rather than (wrongly) looking for a held intent.
  const isSaved = appt.payment_status === "saved"
    || (!appt.payment_intent_id && !!appt.stripe_payment_method_id);
  if (!appt.payment_intent_id && !isSaved) {
    return NextResponse.json({ ok: false, error: "No card is on hold for this appointment." }, { status: 400 });
  }
  if (isSaved && !appt.stripe_payment_method_id) {
    return NextResponse.json({ ok: false, error: "No saved card for this appointment." }, { status: 400 });
  }
  if (appt.payment_status === "captured" || appt.payment_status === "paid") {
    return NextResponse.json({ ok: true, alreadyCaptured: true });
  }

  // No-show fee: a PERCENTAGE of the booked total (booking_settings
  // .no_show_fee_percent), always capped at 80% — the full amount is only ever
  // collected by completing the appointment instead. A "completed" capture
  // leaves feeCents = 0 and captures the whole hold.
  const totalCents = Math.round((appt.total_amount ?? 0) * 100);
  let feeCents = 0;
  if (reason === "no_show") {
    const bs = shop.booking_settings as { no_show_fee_percent?: number } | null;
    const capCents = noShowFeeCents(totalCents, NO_SHOW_MAX_PCT);
    const configuredCents = noShowFeeCents(totalCents, bs?.no_show_fee_percent);
    // Honor an explicit amount from the barber (including 0 = release the hold);
    // fall back to the configured fee when none was sent. Always cap at 80%.
    const requested = typeof amount_cents === "number" ? amount_cents : configuredCents;
    feeCents = Math.min(Math.max(0, requested), capCents);
  }

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
  const opts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;

  // No-show with a 0% fee (or a $0 booking): collect nothing. Release any held
  // authorization so the customer isn't left with a lingering hold, then settle.
  if (reason === "no_show" && feeCents <= 0) {
    if (!isSaved && appt.payment_intent_id) {
      await stripe.paymentIntents.cancel(appt.payment_intent_id, {}, opts).then(null, () => null);
    }
    await supabaseAdmin.from("appointments")
      .update({ payment_status: null }).eq("id", appointment_id).then(null, () => null);
    return NextResponse.json({ ok: true, amount: 0 });
  }

  try {
    let pi: { amount_received?: number | null; id?: string };
    if (isSaved) {
      // Saved card (>7-day booking): nothing is held, so create + confirm a
      // fresh PaymentIntent off-session against the stored card. For a no-show
      // charge the fee; for completion charge the full total + any up-front tip.
      const chargeCents = feeCents > 0
        ? feeCents
        : Math.round(((appt.total_amount ?? 0) + Number(appt.tip_amount ?? 0)) * 100);
      if (chargeCents <= 0) {
        // Nothing to charge (e.g. $0 service) — just mark it settled. paid_at
        // is best-effort so a lagging migration can't fail the request.
        await supabaseAdmin.from("appointments")
          .update({ payment_status: "captured", payment_method: "card" }).eq("id", appointment_id);
        await supabaseAdmin.from("appointments")
          .update({ paid_at: new Date().toISOString() }).eq("id", appointment_id).then(null, () => null);
        return NextResponse.json({ ok: true, amount: 0 });
      }
      pi = await stripe.paymentIntents.create({
        amount: chargeCents,
        currency: "cad",
        customer: appt.stripe_customer_id ?? undefined,
        payment_method: appt.stripe_payment_method_id!,
        off_session: true,
        confirm: true,
      }, opts);
    } else {
      // Held card: capture the existing authorization.
      const captureParams = feeCents > 0 ? { amount_to_capture: feeCents } : {};
      pi = await stripe.paymentIntents.capture(appt.payment_intent_id!, captureParams, opts);
    }
    // Mark settled with the columns that always exist. `paid_at` is written
    // separately + best-effort so a lagging migration can never make this throw
    // and roll a SUCCESSFUL Stripe charge back to "failed" via the catch below.
    await supabaseAdmin.from("appointments")
      .update({ payment_status: "captured", payment_method: "card", payment_intent_id: pi.id ?? appt.payment_intent_id })
      .eq("id", appointment_id);
    await supabaseAdmin.from("appointments")
      .update({ paid_at: new Date().toISOString() })
      .eq("id", appointment_id).then(null, () => null);
    // Best-effort — column may not exist until the Phase 1 migration is run.
    if (reason === "no_show") {
      await supabaseAdmin.from("appointments")
        .update({ no_show_fee_amount: pi.amount_received ?? amount_cents ?? null })
        .eq("id", appointment_id).then(null, () => null);
    }

    // Email the customer a receipt for the charge (fire-and-forget).
    const amountReceived = pi.amount_received ?? 0;
    console.log("[capture-appointment] charged", { appointment_id, reason, isSaved, amountReceived, pi_id: pi.id });
    const { data: svc } = appt.service_id
      ? await supabaseAdmin.from("services").select("name").eq("id", appt.service_id).maybeSingle()
      : { data: null as { name: string } | null };
    const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // Record a transaction row so the charge shows up in Payments / revenue /
    // analytics (appointment payment_status alone isn't in the transactions
    // ledger). Fire-and-forget — never block the charge on bookkeeping.
    // Split the tip out of the captured amount for the ledger (completion only;
    // no tip is ever collected on a no-show fee).
    const tipDollars = reason === "no_show" ? 0 : Math.min(Math.max(0, Number(appt.tip_amount ?? 0)), amountReceived / 100);
    // Split tax out of the captured amount so `amount` is pre-tax revenue and the
    // tax is stored separately (matching the online + POS ledger rows) — so
    // receipts can show a Subtotal/Tax breakdown and analytics can total tax
    // collected. A no-show fee carries no tax.
    const txTax = reason === "no_show" ? 0 : Math.max(0, Number(appt.tax_amount ?? 0));
    const txBase = {
      shop_id: appt.shop_id,
      barber_id: appt.barber_id || null,
      client_name: appt.client_name || null,
      service_name: reason === "no_show" ? `No-show fee — ${svc?.name ?? "appointment"}` : (svc?.name ?? "Service"),
      tip: tipDollars,
      payment_method: "card",
      type: "service",
      appointment_id,
      payment_intent_id: pi.id ?? appt.payment_intent_id ?? null,
      source: reason === "no_show" ? "no_show" : "completion",
    };
    // Real Stripe fee for this capture (split 50/50 barber/shop at read time).
    // Same connected-account context the charge used. Best-effort → 0.
    const feeDollars = (await stripeFeeCents(pi.id ?? appt.payment_intent_id, useConnect ? shop.stripe_account_id : null)) / 100;
    const txAmount = Math.max(0, amountReceived / 100 - tipDollars - txTax);
    const txRes = await supabaseAdmin.from("transactions")
      .insert({ ...txBase, amount: txAmount, tax: txTax, stripe_fee: feeDollars });
    if (txRes.error && /column|does not exist|schema cache/i.test(txRes.error.message)) {
      // `stripe_fee` (phase38) or `tax` (phase30) may lag on prod — drop the
      // missing column(s) and retry so the row + totals still reconcile.
      const res2 = await supabaseAdmin.from("transactions")
        .insert({ ...txBase, amount: txAmount, tax: txTax });
      if (res2.error && /column|does not exist|schema cache/i.test(res2.error.message)) {
        await supabaseAdmin.from("transactions")
          .insert({ ...txBase, amount: amountReceived / 100 - tipDollars }).then(null, () => null);
      }
    }
    sendPaymentReceipt(baseUrl, {
      clientEmail: appt.client_email,
      clientName: appt.client_name,
      shopName: shop.name,
      shopEmail: shop.email,
      serviceName: svc?.name ?? null,
      date: appt.date,
      amountCents: amountReceived,
      context: reason === "no_show" ? "No-show fee" : "Appointment completed",
      // Same split the ledger row uses (txTax/tipDollars) — a no-show fee has 0
      // tax so it stays a single line; a completion itemizes price + tax (+ tip).
      taxCents: Math.round(txTax * 100),
      tipCents: Math.round(tipDollars * 100),
      taxConfig: shop.booking_settings as TaxConfig | null,
    });

    // In-app/web success alert to owner + assigned barber for BOTH a completion
    // charge and a no-show fee (pop-up + chime). No-show also texts the customer.
    notifyNoShowCharged({
      ownerId: shop.owner_id,
      barberId: appt.barber_id,
      shopId: appt.shop_id,
      clientName: appt.client_name,
      amountCents: amountReceived,
      date: appt.date,
      kind: reason === "no_show" ? "no_show" : "completed",
    });
    if (reason === "no_show") {
      sendSmsBestEffort(
        appt.client_phone,
        `You missed your appointment on ${prettyDate(appt.date)}. A no-show fee of $${(amountReceived / 100).toFixed(2)} has been charged.`,
        shop.name,
      );
    } else if (Number(appt.tip_amount ?? 0) <= 0) {
      // Post-visit tip nudge — only when the customer didn't already tip at
      // booking, so we never double-ask. Best-effort SMS with the tip link.
      sendSmsBestEffort(
        appt.client_phone,
        `Thanks for visiting ${shop.name}! If you'd like to leave a tip for your barber, tap here: ${baseUrl}/tip/${appointment_id}`,
        shop.name,
      );
    }

    return NextResponse.json({ ok: true, amount: amountReceived / 100 });
  } catch (err) {
    const e = err as { code?: string; raw?: { code?: string }; message?: string };
    const code = e?.code ?? e?.raw?.code ?? "";
    // A concurrent "Complete" (double-click / double-submit) may have already
    // captured this authorization — Stripe then throws on the second capture.
    // That charge SUCCEEDED, so treat it as success: never clobber the row to
    // "failed" (a "failed" row offers a "send payment link" action → the owner
    // could collect a SECOND time on an already-captured card).
    const alreadyCaptured = /already.*captur|charge_already_captured|payment_intent_unexpected_state/i.test(code)
      || /already been captured|already captured|has already been captured/i.test(e?.message ?? "");
    if (alreadyCaptured) {
      console.warn("[capture-appointment] capture raced — already captured", { appointment_id, reason });
      return NextResponse.json({ ok: true, alreadyCaptured: true });
    }
    // Flag for manual review instead of crashing the UI, and alert the owner
    // in-app so a silent card failure doesn't go unnoticed.
    console.error("[capture-appointment] charge FAILED", {
      appointment_id, reason, isSaved,
      message: err instanceof Error ? err.message : String(err),
      code,
    });
    // Only downgrade to "failed" when the row isn't already settled — a racing
    // successful capture (captured/paid) must win over this error path.
    await supabaseAdmin.from("appointments")
      .update({ payment_status: "failed" })
      .eq("id", appointment_id)
      .in("payment_status", ["unpaid", "held", "saved", "failed"])
      .then(null, () => null);
    notifyChargeFailed({
      ownerId: shop.owner_id,
      shopId: appt.shop_id,
      clientName: appt.client_name,
      amountCents: feeCents > 0 ? feeCents : Math.round((appt.total_amount ?? 0) * 100),
      reason: reason === "no_show" ? "no_show" : "completed",
    });
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Capture failed" }, { status: 500 });
  }
}
