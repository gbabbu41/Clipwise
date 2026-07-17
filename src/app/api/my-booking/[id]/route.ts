import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSlotsInRange, timeToMinutes } from "@/lib/utils";
import { barberHasConflict } from "@/lib/booking-conflict";

// Customer "manage my booking" access, keyed by the appointment UUID — the
// unguessable capability sent in the confirmation email/SMS. appointments RLS is
// stakeholder-only, so the browser (anon) can't read it; this service-role route
// returns ONLY display fields (no client email/phone) and handles cancel /
// reschedule, with a server-side conflict check.

const OCCUPYING = ["pending", "confirmed"];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const slotsDate = new URL(req.url).searchParams.get("slots");

  // Reschedule slot list for THIS booking's barber on a given day.
  if (slotsDate) {
    const { data: appt } = await supabaseAdmin
      .from("appointments").select("barber_id, time_slot").eq("id", id).maybeSingle();
    if (!appt?.barber_id) return NextResponse.json({ slots: [] });
    const dow = new Date(slotsDate + "T00:00:00").getDay();
    const { data: ts } = await supabaseAdmin
      .from("time_slots").select("start_time, end_time")
      .eq("barber_id", appt.barber_id).eq("day_of_week", dow).eq("is_available", true).maybeSingle();
    if (!ts) return NextResponse.json({ slots: [] });
    const { data: booked } = await supabaseAdmin
      .from("appointments").select("time_slot")
      .eq("barber_id", appt.barber_id).eq("date", slotsDate).in("status", OCCUPYING);
    const bookedSlots = (booked ?? []).map(a => a.time_slot as string).filter(s => s !== appt.time_slot);
    return NextResponse.json({ slots: getSlotsInRange(ts.start_time, ts.end_time, new Date(slotsDate + "T00:00:00"), bookedSlots) });
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
    .from("appointments").select("id, shop_id, barber_id, client_name, date, time_slot, status, service_id, duration_minutes").eq("id", id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (appt.status === "cancelled" || appt.status === "completed" || appt.status === "no-show") {
    return NextResponse.json({ error: "This booking can no longer be changed." }, { status: 400 });
  }

  const base = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (body.action === "cancel") {
    await supabaseAdmin.from("appointments").update({ status: "cancelled" }).eq("id", id);
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
      supabaseAdmin.from("notifications").insert({
        user_id: shopRow.owner_id, title: "Appointment Cancelled",
        message: `${appt.client_name} cancelled their appointment (was ${appt.date} at ${appt.time_slot})`,
        type: "cancellation", is_read: false,
      }).then(null, () => null);
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
    await supabaseAdmin.from("appointments").update({ date: body.date, time_slot: body.time_slot, status: "pending" }).eq("id", id);
    return NextResponse.json({ ok: true, date: body.date, time_slot: body.time_slot, status: "pending" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
