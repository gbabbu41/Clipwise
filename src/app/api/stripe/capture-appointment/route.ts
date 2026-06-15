import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPaymentReceipt, notifyChargeFailed, notifyNoShowCharged } from "@/lib/payment-notify";
import { sendSmsBestEffort } from "@/lib/twilio";
import { prettyDate } from "@/lib/utils";

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
    .select("id, shop_id, barber_id, service_id, client_name, client_email, client_phone, date, total_amount, payment_intent_id, payment_status, stripe_customer_id, stripe_payment_method_id")
    .eq("id", appointment_id).maybeSingle();
  if (apptErr || !appt) {
    console.warn("[capture-appointment] appointment NOT FOUND", { appointment_id, apptErr: apptErr?.message });
    return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
  }

  const { data: shop, error: shopErr } = await supabaseAdmin
    .from("shops").select("owner_id, name, email, stripe_account_id, stripe_connected, booking_settings").eq("id", appt.shop_id).maybeSingle();
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

  const isSaved = appt.payment_status === "saved";
  if (!appt.payment_intent_id && !isSaved) {
    return NextResponse.json({ ok: false, error: "No card is on hold for this appointment." }, { status: 400 });
  }
  if (isSaved && !appt.stripe_payment_method_id) {
    return NextResponse.json({ ok: false, error: "No saved card for this appointment." }, { status: 400 });
  }
  if (appt.payment_status === "captured" || appt.payment_status === "paid") {
    return NextResponse.json({ ok: true, alreadyCaptured: true });
  }

  // No-show fee: use the explicit amount if given, else the shop's configured
  // flat fee (booking_settings.no_show_fee_amount, in $), else the full hold.
  let feeCents = amount_cents && amount_cents > 0 ? amount_cents : 0;
  if (reason === "no_show" && !feeCents) {
    const bs = shop.booking_settings as { no_show_fee_amount?: number } | null;
    const feeDollars = bs?.no_show_fee_amount ?? 0;
    if (feeDollars > 0) feeCents = Math.min(Math.round(feeDollars * 100), Math.round((appt.total_amount ?? 0) * 100));
  }

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);
  const opts = useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined;

  try {
    let pi: { amount_received?: number | null; id?: string };
    if (isSaved) {
      // Saved card (>7-day booking): nothing is held, so create + confirm a
      // fresh PaymentIntent off-session against the stored card. For a no-show
      // charge the fee; for completion charge the full total.
      const chargeCents = feeCents > 0
        ? feeCents
        : Math.round((appt.total_amount ?? 0) * 100);
      if (chargeCents <= 0) {
        // Nothing to charge (e.g. $0 service) — just mark it settled.
        await supabaseAdmin.from("appointments")
          .update({ payment_status: "captured", payment_method: "card", paid_at: new Date().toISOString() }).eq("id", appointment_id);
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
    await supabaseAdmin.from("appointments")
      .update({ payment_status: "captured", payment_method: "card", payment_intent_id: pi.id ?? appt.payment_intent_id, paid_at: new Date().toISOString() })
      .eq("id", appointment_id);
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
    await supabaseAdmin.from("transactions").insert({
      shop_id: appt.shop_id,
      barber_id: appt.barber_id || null,
      client_name: appt.client_name || null,
      service_name: reason === "no_show" ? `No-show fee — ${svc?.name ?? "appointment"}` : (svc?.name ?? "Service"),
      amount: amountReceived / 100,
      tip: 0,
      payment_method: "card",
      type: "service",
    }).then(null, () => null);
    sendPaymentReceipt(baseUrl, {
      clientEmail: appt.client_email,
      clientName: appt.client_name,
      shopName: shop.name,
      shopEmail: shop.email,
      serviceName: svc?.name ?? null,
      date: appt.date,
      amountCents: amountReceived,
      context: reason === "no_show" ? "No-show fee" : "Appointment completed",
    });

    // In-app/web success alert to owner + assigned barber for BOTH a completion
    // charge and a no-show fee (pop-up + chime). No-show also texts the customer.
    notifyNoShowCharged({
      ownerId: shop.owner_id,
      barberId: appt.barber_id,
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
    }

    return NextResponse.json({ ok: true, amount: amountReceived / 100 });
  } catch (err) {
    // Flag for manual review instead of crashing the UI, and alert the owner
    // in-app so a silent card failure doesn't go unnoticed.
    console.error("[capture-appointment] charge FAILED", {
      appointment_id, reason, isSaved,
      message: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string })?.code,
    });
    await supabaseAdmin.from("appointments")
      .update({ payment_status: "failed" }).eq("id", appointment_id).then(null, () => null);
    notifyChargeFailed({
      ownerId: shop.owner_id,
      clientName: appt.client_name,
      amountCents: feeCents > 0 ? feeCents : Math.round((appt.total_amount ?? 0) * 100),
      reason: reason === "no_show" ? "no_show" : "completed",
    });
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Capture failed" }, { status: 500 });
  }
}
