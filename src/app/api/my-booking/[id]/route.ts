import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";
import { getSlotsInRange, timeToMinutes } from "@/lib/utils";
import { barberHasConflict } from "@/lib/booking-conflict";
import { OCCUPYING_STATUSES, holdsSlot } from "@/lib/availability";
import { scheduleBlockReason } from "@/lib/schedule-block";
import { safeTz, todayInTz, nowMinutesInTz } from "@/lib/timezone";
import { stripe } from "@/lib/stripe";

// Customer "manage my booking" access, keyed by the appointment UUID — the
// unguessable capability sent in the confirmation email/SMS. appointments RLS is
// stakeholder-only, so the browser (anon) can't read it; this service-role route
// returns ONLY display fields (no client email/phone) and handles cancel /
// reschedule, with a server-side conflict check.

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const slotsDate = new URL(req.url).searchParams.get("slots");

  // Reschedule slot list for THIS booking's barber on a given day.
  if (slotsDate) {
    const { data: appt } = await supabaseAdmin
      .from("appointments").select("barber_id, time_slot, shop_id, shops(timezone, booking_settings)").eq("id", id).maybeSingle();
    if (!appt?.barber_id) return NextResponse.json({ slots: [] });
    const dow = new Date(slotsDate + "T00:00:00").getDay();
    // A barber can have MULTIPLE rows for one day (split shift) — aggregate to the
    // widest window rather than .maybeSingle() (which errors on >1 row → no slots).
    const { data: tsRows } = await supabaseAdmin
      .from("time_slots").select("start_time, end_time")
      .eq("barber_id", appt.barber_id).eq("day_of_week", dow).eq("is_available", true);
    if (!tsRows || tsRows.length === 0) return NextResponse.json({ slots: [] });
    const startTime = tsRows.reduce((m, r) => (r.start_time < m ? r.start_time : m), tsRows[0].start_time);
    const endTime = tsRows.reduce((m, r) => (r.end_time > m ? r.end_time : m), tsRows[0].end_time);
    const { data: booked } = await supabaseAdmin
      .from("appointments").select("time_slot, payment_status")
      .eq("barber_id", appt.barber_id).eq("date", slotsDate).in("status", OCCUPYING_STATUSES);
    const bookedSlots = (booked ?? [])
      .filter(holdsSlot)     // refunded frees the slot
      .map(a => a.time_slot as string).filter(s => s !== appt.time_slot);
    // Judge "past" in the SHOP's timezone, not the server's UTC — otherwise
    // same-day morning slots get wrongly hidden (Canada is hours behind UTC).
    const shopRel = (appt as { shops?: { timezone?: string; booking_settings?: { slot_interval_minutes?: number } } | { timezone?: string; booking_settings?: { slot_interval_minutes?: number } }[] }).shops;
    const shopObj = Array.isArray(shopRel) ? shopRel[0] : shopRel;
    const tz = safeTz(shopObj?.timezone ?? null);
    // Honor the shop's slot granularity (15 or 30) instead of hardcoding 30.
    const interval = Number(shopObj?.booking_settings?.slot_interval_minutes) === 15 ? 15 : 30;
    const nowOverride = { todayStr: todayInTz(tz), nowMinutes: nowMinutesInTz(tz) };
    return NextResponse.json({ slots: getSlotsInRange(startTime, endTime, new Date(slotsDate + "T00:00:00"), bookedSlots, interval, nowOverride) });
  }

  // The booking itself — display fields only (never client email/phone).
  const { data } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, client_name, date, time_slot, status, total_amount, payment_status, duration_minutes, barbers(id, name), services(id, name, price, duration_minutes), shops(id, name, slug, address, city, province, phone)")
    .eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ booking: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const body = await req.json() as { action?: "cancel" | "reschedule"; date?: string; time_slot?: string };

  const { data: appt } = await supabaseAdmin
    .from("appointments").select("id, shop_id, barber_id, client_name, date, time_slot, status, service_id, duration_minutes, payment_status, payment_intent_id").eq("id", id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (appt.status === "cancelled" || appt.status === "completed" || appt.status === "no-show") {
    return NextResponse.json({ error: "This booking can no longer be changed." }, { status: 400 });
  }

  const base = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (body.action === "cancel") {
    await supabaseAdmin.from("appointments").update({ status: "cancelled" }).eq("id", id);
    // Release a no-show card HOLD so the customer's card isn't left authorized
    // until Stripe auto-voids (~7 days). Only a held (uncaptured) auth is
    // released — a captured/paid booking is a refund policy decision, left alone.
    if (appt.payment_status === "held" && appt.payment_intent_id) {
      const { data: shopStripe } = await supabaseAdmin
        .from("shops").select("stripe_account_id").eq("id", appt.shop_id).maybeSingle();
      const opts = shopStripe?.stripe_account_id ? { stripeAccount: shopStripe.stripe_account_id } : {};
      await stripe.paymentIntents.cancel(appt.payment_intent_id, {}, opts).then(null, () => null);
      await supabaseAdmin.from("appointments").update({ payment_status: "voided" }).eq("id", id).then(null, () => null);
    }
    // Notify barber + waitlist + owner (server-side, fire-and-forget).
    fetch(`${base}/api/appointments/notify-cancellation`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: id, statusLabel: "Cancelled" }),
    }).catch(() => null);
    fetch(`${base}/api/waitlist/slot-opened`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: id }),
    }).catch(() => null);
    const { data: shopRow } = await supabaseAdmin.from("shops").select("owner_id").eq("id", appt.shop_id).maybeSingle();
    if (shopRow?.owner_id) {
      insertNotifications({
        user_id: shopRow.owner_id, shop_id: appt.shop_id, title: "Appointment Cancelled",
        message: `${appt.client_name} cancelled their appointment (was ${appt.date} at ${appt.time_slot})`,
        type: "cancellation",
      });
    }
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  if (body.action === "reschedule") {
    if (!body.date || !body.time_slot) return NextResponse.json({ error: "Missing date/time" }, { status: 400 });
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
    await supabaseAdmin.from("appointments").update({ date: body.date, time_slot: body.time_slot }).eq("id", id);
    // Reschedule vacates the OLD slot — ping the waitlist for that date/barber so
    // anyone waiting on the original day gets a shot (every other freeing
    // transition — cancel/reject/no-show — already does this).
    fetch(`${base}/api/waitlist/slot-opened`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: appt.shop_id, date: oldDate, barber_id: appt.barber_id }),
    }).catch(() => null);
    // Informational notice to owner + barber that the time moved (NOT a re-approval).
    const { data: shopRow } = await supabaseAdmin.from("shops").select("owner_id").eq("id", appt.shop_id).maybeSingle();
    let barberUserId: string | null = null;
    if (appt.barber_id) {
      const { data: b } = await supabaseAdmin.from("barbers").select("user_id").eq("id", appt.barber_id).maybeSingle();
      barberUserId = (b as { user_id?: string } | null)?.user_id ?? null;
    }
    const msg = `${appt.client_name} rescheduled to ${body.date} at ${body.time_slot} (was ${appt.date} at ${appt.time_slot})`;
    const targets = Array.from(new Set([shopRow?.owner_id, barberUserId].filter(Boolean))) as string[];
    for (const uid of targets) {
      insertNotifications({
        user_id: uid, shop_id: appt.shop_id, title: "Appointment Rescheduled", message: msg, type: "booking",
      });
    }
    return NextResponse.json({ ok: true, date: body.date, time_slot: body.time_slot, status: appt.status });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
