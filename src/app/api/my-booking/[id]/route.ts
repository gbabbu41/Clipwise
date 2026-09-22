import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";
import { getSlotsInRange, timeToMinutes, prettyDate, dbTimeToDisplay } from "@/lib/utils";
import { barberHasConflict, isDoubleBookError } from "@/lib/booking-conflict";
import { OCCUPYING_STATUSES, holdsSlot, apptDuration } from "@/lib/availability";
import { scheduleBlockReason } from "@/lib/schedule-block";
import { safeTz, todayInTz, nowMinutesInTz, isBookingInPast, hoursUntilBooking } from "@/lib/timezone";
import { refundOrReleaseHold } from "@/lib/stripe-refund";
import { recordRefundLedger } from "@/lib/refund-ledger";
import { notifyRefundIssued } from "@/lib/payment-notify";
import { sendAppEmail } from "@/lib/emailer";
import { enforceRateLimit } from "@/lib/rate-limit";
import { notifyWaitlistForSlot } from "@/lib/waitlist-notify-server";

// Customer "manage my booking" access, keyed by the appointment UUID — the
// unguessable capability sent in the confirmation email/SMS. appointments RLS is
// stakeholder-only, so the browser (anon) can't read it; this service-role route
// returns ONLY display fields (no client email/phone) and handles cancel /
// reschedule, with a server-side conflict check.

// This link is the single source of truth for the customer — it must ALWAYS
// reflect the booking's current state (e.g. after the shop moves the time or
// reassigns the barber). Force dynamic + no-store so neither Vercel's edge nor
// the browser can serve a stale snapshot of a since-edited booking.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const slotsDate = new URL(req.url).searchParams.get("slots");

  // Reschedule slot list for THIS booking's barber on a given day.
  if (slotsDate) {
    const limited = enforceRateLimit(req, "manage-booking-slots", 60, 60_000);
    if (limited) return limited;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slotsDate) || !Number.isFinite(Date.parse(`${slotsDate}T12:00:00Z`))
      || new Date(`${slotsDate}T12:00:00Z`).toISOString().slice(0, 10) !== slotsDate) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400, headers: NO_STORE });
    }
    const unavailable = () => NextResponse.json({ error: "Couldn't load available times. Please try again." }, { status: 503, headers: NO_STORE });
    const { data: appt, error: apptError } = await supabaseAdmin
      .from("appointments").select("barber_id, time_slot, shop_id, duration_minutes, services(duration_minutes), shops(timezone, booking_settings)").eq("id", id).maybeSingle();
    if (apptError) return unavailable();
    if (!appt?.barber_id) return NextResponse.json({ slots: [] }, { headers: NO_STORE });
    const dow = new Date(slotsDate + "T00:00:00").getDay();
    const [hoursRes, bookedRes, offRes, breaksRes] = await Promise.all([
      supabaseAdmin.from("time_slots").select("start_time, end_time")
        .eq("barber_id", appt.barber_id).eq("day_of_week", dow).eq("is_available", true),
      supabaseAdmin.from("appointments").select("id, time_slot, duration_minutes, payment_status, services(duration_minutes)")
        .eq("barber_id", appt.barber_id).eq("date", slotsDate).in("status", OCCUPYING_STATUSES).neq("id", id),
      supabaseAdmin.from("time_off_requests").select("type, start_time, end_time, barber_id")
        .eq("shop_id", appt.shop_id).eq("status", "approved").lte("start_date", slotsDate).gte("end_date", slotsDate),
      supabaseAdmin.from("barber_breaks").select("start_time, end_time")
        .eq("barber_id", appt.barber_id).eq("day_of_week", dow),
    ]);
    if (hoursRes.error || bookedRes.error || offRes.error || breaksRes.error) return unavailable();
    const tsRows = hoursRes.data;
    if (!tsRows || tsRows.length === 0) return NextResponse.json({ slots: [] }, { headers: NO_STORE });
    const startTime = tsRows.reduce((m, r) => (r.start_time < m ? r.start_time : m), tsRows[0].start_time);
    const endTime = tsRows.reduce((m, r) => (r.end_time > m ? r.end_time : m), tsRows[0].end_time);
    const booked = (bookedRes.data ?? []).filter(holdsSlot);
    const offs = (offRes.data ?? []).filter(o => !o.barber_id || o.barber_id === appt.barber_id);
    const fullDayOff = offs.some(o => ["day_off", "vacation", "sick"].includes(o.type));
    const blocked = [...(breaksRes.data ?? []), ...offs.filter(o => o.type === "blocked_hours")];
    // Judge "past" in the SHOP's timezone, not the server's UTC — otherwise
    // same-day morning slots get wrongly hidden (Canada is hours behind UTC).
    const shopRel = (appt as { shops?: { timezone?: string; booking_settings?: { slot_interval_minutes?: number } } | { timezone?: string; booking_settings?: { slot_interval_minutes?: number } }[] }).shops;
    const shopObj = Array.isArray(shopRel) ? shopRel[0] : shopRel;
    const tz = safeTz(shopObj?.timezone ?? null);
    // Honor the shop's slot granularity (15 or 30) instead of hardcoding 30.
    const interval = Number(shopObj?.booking_settings?.slot_interval_minutes) === 15 ? 15 : 30;
    const nowOverride = { todayStr: todayInTz(tz), nowMinutes: nowMinutesInTz(tz) };
    const duration = apptDuration(appt);
    const dbMinutes = (value: string) => timeToMinutes(dbTimeToDisplay(value));
    const shifts: { start: number; end: number }[] = [];
    for (const shift of tsRows.map(s => ({ start: dbMinutes(s.start_time), end: dbMinutes(s.end_time) })).sort((a, b) => a.start - b.start)) {
      const previous = shifts[shifts.length - 1];
      if (previous && shift.start <= previous.end) previous.end = Math.max(previous.end, shift.end);
      else shifts.push(shift);
    }
    const slots = getSlotsInRange(startTime, endTime, new Date(slotsDate + "T00:00:00"), [], interval, nowOverride)
      .map(row => {
        const start = timeToMinutes(row.slot), end = start + duration;
        // Use the full booked duration, not just the start or grid interval.
        const withinShift = shifts.some(shift => start >= shift.start && end <= shift.end);
        const occupied = booked.some(other => {
          const otherStart = timeToMinutes(other.time_slot);
          return start < otherStart + apptDuration(other) && end > otherStart;
        });
        const onBreak = blocked.some(b => b.start_time && b.end_time && start < dbMinutes(b.end_time) && end > dbMinutes(b.start_time));
        return { ...row, available: row.available && slotsDate >= nowOverride.todayStr && withinShift && !fullDayOff && !occupied && !onBreak };
      });
    return NextResponse.json({ slots }, { headers: NO_STORE });
  }

  // The booking itself — display fields only (never client email/phone).
  const { data } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, client_name, date, time_slot, status, total_amount, payment_status, duration_minutes, barbers(id, name), services(id, name, price, duration_minutes), shops(id, name, slug, address, city, province, phone, timezone, booking_settings)")
    .eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ booking: data }, { headers: NO_STORE });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  // The manage link is a capability URL (anyone holding it can act), so throttle
  // per-IP — stops replaying cancel/reschedule to spam customer SMS + staff emails.
  const limited = enforceRateLimit(req, "manage-booking", 12, 60_000);
  if (limited) return limited;
  const { id } = params;
  const body = await req.json() as { action?: "cancel" | "reschedule"; date?: string; time_slot?: string };

  const { data: appt } = await supabaseAdmin
    .from("appointments").select("id, shop_id, barber_id, client_name, client_email, client_phone, date, time_slot, status, service_id, duration_minutes, payment_status, payment_intent_id, total_amount, tip_amount, tax_amount, services(name)").eq("id", id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (appt.status === "cancelled" || appt.status === "completed" || appt.status === "no-show") {
    return NextResponse.json({ error: "This booking can no longer be changed." }, { status: 400 });
  }

  // ── Cancellation-notice window (server-authoritative) ──────────────────────
  // A customer can't self-cancel OR reschedule inside the shop's required notice
  // (booking_settings.cancellation_hours), judged in the shop's timezone. Default
  // 2 hours when unset (0 = the owner explicitly turned the restriction off). This
  // is the actual enforcement — the UI also hides the buttons, but the server is
  // the source of truth.
  const { data: shopCfg } = await supabaseAdmin
    .from("shops").select("timezone, booking_settings").eq("id", appt.shop_id).maybeSingle();
  const cancelHours = Number((shopCfg?.booking_settings as { cancellation_hours?: number } | null)?.cancellation_hours ?? 2);
  if (cancelHours > 0 && (body.action === "cancel" || body.action === "reschedule")) {
    const hrs = hoursUntilBooking(appt.date, appt.time_slot, (shopCfg as { timezone?: string | null } | null)?.timezone ?? null);
    if (hrs < cancelHours) {
      const noun = body.action === "cancel" ? "Cancellations" : "Reschedules";
      return NextResponse.json({
        error: `${noun} require at least ${cancelHours}h notice. Please contact the shop directly to change this booking.`,
      }, { status: 403 });
    }
  }

  const base = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";

  if (body.action === "cancel") {
    const { data: cancelled, error: cancelError } = await supabaseAdmin
      .from("appointments").update({ status: "cancelled" }).eq("id", id)
      .eq("status", appt.status).eq("date", appt.date).eq("time_slot", appt.time_slot)
      .select("id, status").maybeSingle();
    if (cancelError) {
      return NextResponse.json({ error: "Couldn't save the cancellation. Please refresh your booking and try again." }, { status: 503 });
    }
    if (!cancelled) {
      return NextResponse.json({ error: "This booking changed while you were cancelling it. Please refresh and try again." }, { status: 409 });
    }
    // Auto money-back on a customer self-cancel. Self-cancel is ONLY permitted with
    // enough notice (the window check above), so an in-window cancel earns a FULL
    // refund — the Squire model. A paid/captured booking is refunded; a legacy
    // HELD (uncaptured) auth is just released. Late cancels / no-shows can't
    // self-cancel — those stay on the shop side (keep the money / charge the fee).
    if (appt.payment_intent_id && ["paid", "captured", "held"].includes(appt.payment_status ?? "")) {
      const { data: shopPay } = await supabaseAdmin
        .from("shops").select("stripe_account_id, name, email, slug, owner_id").eq("id", appt.shop_id).maybeSingle();
      if (shopPay?.stripe_account_id) {
        try {
          const r = await refundOrReleaseHold(appt.payment_intent_id, shopPay.stripe_account_id, `cancel-refund-${appt.payment_intent_id}`);
          await supabaseAdmin.from("appointments")
            .update({ payment_status: r.released ? "voided" : "refunded" }).eq("id", id).then(null, () => null);
          // Real money moved (not just a hold released) → correct the ledger, alert
          // the shop, and email the customer their refund. Mirrors refund-payment.
          if (!r.released) {
            const refundedCents = r.refundedCents ?? Math.round((appt.total_amount ?? 0) * 100);
            await supabaseAdmin.from("transactions")
              .update({ refunded: true }).eq("payment_intent_id", appt.payment_intent_id).neq("source", "refund").then(null, () => null);
            const chargeCents = Math.round((appt.total_amount ?? 0) * 100) + Math.round((appt.tip_amount ?? 0) * 100);
            const taxPart = chargeCents > 0 ? Math.round(refundedCents * (Math.round((appt.tax_amount ?? 0) * 100) / chargeCents)) : 0;
            const tipPart = chargeCents > 0 ? Math.round(refundedCents * (Math.round((appt.tip_amount ?? 0) * 100) / chargeCents)) : 0;
            const svcRel = appt.services as unknown as { name?: string } | { name?: string }[] | null;
            const svcName = (Array.isArray(svcRel) ? svcRel[0]?.name : svcRel?.name) ?? null;
            await recordRefundLedger({
              shopId: appt.shop_id, barberId: appt.barber_id, clientName: appt.client_name,
              serviceName: svcName, refundedCents, taxCents: taxPart, tipCents: tipPart,
              appointmentId: appt.id, paymentIntentId: appt.payment_intent_id,
            }).catch(() => null);
            if (shopPay.owner_id) {
              notifyRefundIssued({
                ownerId: shopPay.owner_id, barberId: appt.barber_id, shopId: appt.shop_id,
                clientName: appt.client_name, amountCents: refundedCents, date: appt.date,
              });
            }
            if (appt.client_email) {
              await sendAppEmail("refund_issued", {
                clientName: appt.client_name ?? "there", clientEmail: appt.client_email,
                shopName: shopPay.name ?? "", shopEmail: shopPay.email ?? "", shopSlug: shopPay.slug ?? "",
                serviceName: svcName ?? "Your service", date: appt.date ?? "",
                total: `$${(refundedCents / 100).toFixed(2)}`,
              }).catch(() => null);
            }
          }
        } catch { /* refund failed — leave the money state; owner can refund manually */ }
      }
    }
    // Notify barber + waitlist + owner (server-side, fire-and-forget).
    fetch(`${base}/api/appointments/notify-cancellation`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: id, statusLabel: "Cancelled" }),
    }).catch(() => null);
    await notifyWaitlistForSlot({ shop_id: appt.shop_id, date: appt.date, barber_id: appt.barber_id }).catch(() => null);
    const { data: shopRow } = await supabaseAdmin.from("shops").select("owner_id, name, email").eq("id", appt.shop_id).maybeSingle();
    // Dedupe: on a solo owner-barber shop the owner IS the assigned barber, and
    // notify-cancellation above already alerted them (as the barber). Only add the
    // owner notification when the owner is a DIFFERENT person, or there's no
    // assigned barber — otherwise the owner-barber gets two "cancelled" pop-ups.
    let barberUserId: string | null = null;
    if (appt.barber_id) {
      const { data: b } = await supabaseAdmin.from("barbers").select("user_id").eq("id", appt.barber_id).maybeSingle();
      barberUserId = b?.user_id ?? null;
    }
    if (shopRow?.owner_id && shopRow.owner_id !== barberUserId) {
      insertNotifications({
        user_id: shopRow.owner_id, shop_id: appt.shop_id, title: "Appointment cancelled",
        message: `${appt.client_name} cancelled their appointment (was ${appt.date} at ${appt.time_slot})`,
        type: "cancellation",
      });
    }
    // Email the owner too (in-app alone misses them when they're out of the app).
    // Sent server-side via sendAppEmail (no HTTP relay hop). The barber gets their
    // own email via notify-cancellation above.
    if (shopRow?.email) {
      const [{ data: bRow }, { data: sRow }] = await Promise.all([
        appt.barber_id ? supabaseAdmin.from("barbers").select("name").eq("id", appt.barber_id).maybeSingle() : Promise.resolve({ data: null as { name: string } | null }),
        appt.service_id ? supabaseAdmin.from("services").select("name").eq("id", appt.service_id).maybeSingle() : Promise.resolve({ data: null as { name: string } | null }),
      ]);
      sendAppEmail("appointment_cancelled", {
        ownerEmail: shopRow.email,
        shopName: shopRow.name ?? "",
        clientName: appt.client_name ?? "A client",
        serviceName: sRow?.name ?? "Service",
        barberName: bRow?.name ?? "—",
        date: appt.date ?? "",
        time: appt.time_slot ?? "",
      }).catch(() => null);
    }
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  if (body.action === "reschedule") {
    if (!body.date || !body.time_slot) return NextResponse.json({ error: "Missing date/time" }, { status: 400 });
    // No-op guard: rescheduling to the SAME date/time changes nothing — return
    // success WITHOUT firing the customer SMS + customer/barber/owner emails
    // (replaying it would otherwise spam everyone and burn Twilio/Resend).
    if (body.date === appt.date && body.time_slot === appt.time_slot) {
      return NextResponse.json({ ok: true, status: appt.status, unchanged: true });
    }
    // Universal past-booking block (shop-timezone aware) — can't reschedule INTO
    // the past. Judged in the shop's timezone, not the server's UTC.
    const { data: shopTz } = await supabaseAdmin.from("shops").select("timezone").eq("id", appt.shop_id).maybeSingle();
    if (isBookingInPast(body.date, body.time_slot, shopTz?.timezone)) {
      return NextResponse.json({ error: "That time has already passed — please pick a future time." }, { status: 400 });
    }
    // Server-side conflict check for the new window (excludes this appointment).
    let duration = Number(appt.duration_minutes ?? 0);
    if (!duration && appt.service_id) {
      const { data: svc } = await supabaseAdmin.from("services").select("duration_minutes").eq("id", appt.service_id).maybeSingle();
      duration = svc?.duration_minutes ?? 30;
    }
    if (!duration) duration = 30;
    const startMin = timeToMinutes(body.time_slot);
    if (appt.barber_id && await barberHasConflict(appt.barber_id, body.date, startMin, startMin + duration, appt.id)) {
      return NextResponse.json({ error: "That time was just booked — please pick another slot." }, { status: 409 });
    }
    // Don't let a reschedule land on the barber's approved time-off or a
    // recurring break — the conflict check above only looks at other
    // appointments, so without this a crafted PATCH (or a slot blocked after the
    // page loaded) could move the booking onto a day off / lunch.
    if (appt.barber_id) {
      const blockReason = await scheduleBlockReason(appt.shop_id, appt.barber_id, body.date, startMin, startMin + duration, { includeBreaks: true });
      if (blockReason) return NextResponse.json({ error: blockReason }, { status: 409 });
    }
    // Preserve the booking's state — a confirmed (card-held) booking stays
    // confirmed after a reschedule, so it does NOT go back to the owner as a new
    // request to approve. The card hold / payment_intent is untouched and still
    // applies to the new time. Only a still-pending booking stays pending.
    const oldDate = appt.date;
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("appointments").update({ date: body.date, time_slot: body.time_slot }).eq("id", id)
      .eq("status", appt.status).eq("date", appt.date).eq("time_slot", appt.time_slot)
      .select("id, date, time_slot, status").maybeSingle();
    if (updateError) {
      return NextResponse.json({
        error: isDoubleBookError(updateError)
          ? "That time was just booked — please pick another slot."
          : "Couldn't save the new time. Please refresh your booking and try again.",
      }, { status: isDoubleBookError(updateError) ? 409 : 503 });
    }
    if (!updated) {
      return NextResponse.json({ error: "This booking changed while you were rescheduling it. Please refresh and try again." }, { status: 409 });
    }
    // Reschedule vacates the OLD slot — ping the waitlist for that date/barber so
    // anyone waiting on the original day gets a shot (every other freeing
    // transition — cancel/reject/no-show — already does this).
    await notifyWaitlistForSlot({ shop_id: appt.shop_id, date: oldDate, barber_id: appt.barber_id }).catch(() => null);
    // Tell everyone the time moved — the CUSTOMER (email + SMS confirmation), the
    // BARBER (in-app + email), and the owner (in-app). Mirrors the shop-side edit
    // so a reschedule from either side reaches the same people (NOT a re-approval).
    const [{ data: shopRow }, { data: bRow }, { data: sRow }] = await Promise.all([
      supabaseAdmin.from("shops").select("owner_id, name, email, subscription_plan, subscription_status").eq("id", appt.shop_id).maybeSingle(),
      appt.barber_id
        ? supabaseAdmin.from("barbers").select("name, email, user_id").eq("id", appt.barber_id).maybeSingle()
        : Promise.resolve({ data: null as { name: string; email: string | null; user_id: string | null } | null }),
      appt.service_id
        ? supabaseAdmin.from("services").select("name").eq("id", appt.service_id).maybeSingle()
        : Promise.resolve({ data: null as { name: string } | null }),
    ]);
    const whenNice = `${prettyDate(body.date)} at ${body.time_slot}`;

    // Customer confirmation — same "your appointment was updated" notice the
    // shop-side edit sends. Awaited (best-effort) so a serverless freeze can't drop it.
    if (appt.client_email) {
      await sendAppEmail("appointment_updated", {
        clientEmail: appt.client_email, clientName: appt.client_name ?? "there",
        shopName: shopRow?.name ?? "", barberName: bRow?.name ?? "Your barber",
        serviceName: sRow?.name ?? "Service", date: prettyDate(body.date), time: body.time_slot,
        total: "", appointmentId: id, changedSummary: `New time: ${whenNice}`,
      }).catch(() => null);
    }
    // No reschedule-confirmation SMS: the customer just moved the time themselves
    // on this page, so a text is redundant. The email above still confirms it, and
    // the day-before reminder texts the new time.
    // Barber email so they see the new time even when they're out of the app.
    if (bRow?.email) {
      await sendAppEmail("barber_appointment_change", {
        barberEmail: bRow.email, barberName: bRow.name ?? "there",
        shopName: shopRow?.name ?? "", shopEmail: shopRow?.email ?? "",
        clientName: appt.client_name ?? "A client", serviceName: sRow?.name ?? "Service",
        date: body.date, time: body.time_slot, statusLabel: "Rescheduled",
      }).catch(() => null);
    }
    // In-app pop-up for owner + barber.
    const msg = `${appt.client_name} rescheduled to ${body.date} at ${body.time_slot} (was ${appt.date} at ${appt.time_slot})`;
    const targets = Array.from(new Set([shopRow?.owner_id, bRow?.user_id].filter(Boolean))) as string[];
    for (const uid of targets) {
      insertNotifications({
        user_id: uid, shop_id: appt.shop_id, title: "Appointment rescheduled", message: msg, type: "booking",
      });
    }
    return NextResponse.json({ ok: true, date: updated.date, time_slot: updated.time_slot, status: updated.status });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
