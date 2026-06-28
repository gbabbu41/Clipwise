import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { barberHasConflict, findAvailableBarber, UNIQUE_VIOLATION } from "@/lib/booking-conflict";
import { timeToMinutes } from "@/lib/utils";

/**
 * Create a pay-in-person (or no-charge) appointment server-side.
 *
 * The customer booking page is anonymous; the appointments RLS lets anon INSERT
 * but NOT SELECT, so the old client-side clash check was blind and let two
 * customers grab the same slot. This route runs the conflict check with the
 * service-role client (sees real bookings), resolves "Any Available" to a
 * concrete free barber, and lets the DB unique index backstop the exact-slot
 * race. Money is never touched here (in-person / unpaid).
 */
export async function POST(request: NextRequest) {
  const b = await request.json() as {
    shop_id: string;
    barber_id?: string | null;       // null / "any" → auto-resolve
    service_id: string;              // primary service
    service_names?: string;          // "Haircut + Beard" for the multi-service note
    duration_minutes?: number;       // combined block length
    client_name: string;
    client_email?: string;
    client_phone?: string;
    date: string;                    // YYYY-MM-DD
    time_slot: string;               // "9:00 AM"
    total_amount: number;
    pay_in_person?: boolean;         // tag the row as cash/unpaid
    confirmed?: boolean;             // owner-booked → skip the approval queue
    note?: string;                   // extra note (e.g. "outside working hours")
  };

  if (!b.shop_id || !b.service_id || !b.client_name || !b.date || !b.time_slot) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Shop must exist + be live; read auto-confirm fresh (server is the source of truth).
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, status, booking_settings, owner_id").eq("id", b.shop_id).maybeSingle();
  if (!shop || (shop.status !== "approved")) {
    return NextResponse.json({ error: "This shop isn't accepting bookings." }, { status: 403 });
  }
  // Emergency pause — block customer self-bookings, but still let the owner add
  // walk-ins manually from the dashboard (b.confirmed = owner-initiated).
  if (!b.confirmed && (shop.booking_settings as { bookings_paused?: boolean } | null)?.bookings_paused) {
    return NextResponse.json({ error: "This shop isn't accepting bookings right now." }, { status: 403 });
  }
  const autoConfirm = !!(shop.booking_settings as { auto_confirm?: boolean } | null)?.auto_confirm;

  // Resolve duration → conflict window.
  const startMin = timeToMinutes(b.time_slot);
  let duration = b.duration_minutes && b.duration_minutes > 0 ? b.duration_minutes : 0;
  if (!duration) {
    const { data: svc } = await supabaseAdmin
      .from("services").select("duration_minutes").eq("id", b.service_id).maybeSingle();
    duration = svc?.duration_minutes ?? 30;
  }
  const endMin = startMin + duration;

  // Resolve barber + conflict check (service-role → sees real bookings).
  let barberId = b.barber_id && b.barber_id !== "any" ? b.barber_id : null;
  if (barberId) {
    if (await barberHasConflict(barberId, b.date, startMin, endMin)) {
      return NextResponse.json({ error: "Sorry, that time was just booked. Please pick another slot." }, { status: 409 });
    }
  } else {
    barberId = await findAvailableBarber(b.shop_id, b.date, startMin, endMin);
    if (!barberId) {
      return NextResponse.json({ error: "Sorry, that time is fully booked. Please pick another slot." }, { status: 409 });
    }
  }

  // Don't book over a block / time-off. Approved blocked-hours that overlap the
  // window, or any full-day off (day_off/vacation/sick), make the slot unbookable
  // — even for an owner-added appointment (unblock first to override).
  const mins24 = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const { data: offs } = await supabaseAdmin
    .from("time_off_requests")
    .select("type, start_time, end_time, barber_id")
    .eq("shop_id", b.shop_id).eq("status", "approved")
    .lte("start_date", b.date).gte("end_date", b.date);
  const blockedHit = (offs ?? []).some(o => {
    if (o.barber_id && o.barber_id !== barberId) return false; // other barber's block (null = shop-wide)
    if (o.type === "day_off" || o.type === "vacation" || o.type === "sick") return true;
    if (o.type === "blocked_hours" && o.start_time && o.end_time) {
      return startMin < mins24(o.end_time) && endMin > mins24(o.start_time);
    }
    return false;
  });
  if (blockedHit) {
    return NextResponse.json({ error: "That time is blocked for this barber. Unblock it or pick another time." }, { status: 409 });
  }

  // Owner-initiated bookings (b.confirmed) skip approval; customer self-bookings
  // still respect the shop's auto-confirm setting.
  const status = (b.confirmed || autoConfirm) ? "confirmed" : "pending";
  const noteParts = [b.note, b.service_names ? `Services: ${b.service_names}` : null].filter(Boolean);
  const baseRow = {
    shop_id: b.shop_id,
    barber_id: barberId,
    service_id: b.service_id,
    client_name: b.client_name,
    client_email: b.client_email ?? null,
    client_phone: b.client_phone ?? null,
    date: b.date,
    time_slot: b.time_slot,
    status,
    total_amount: b.total_amount ?? 0,
    deposit_paid: false,
    payment_method: b.pay_in_person ? "cash" : null,
    payment_status: b.pay_in_person ? "unpaid" : null,
    notes: noteParts.length ? noteParts.join(" · ") : null,
  };

  // Insert with duration_minutes; if the column doesn't exist yet (pre-phase14),
  // retry without it so booking still works (occupancy degrades to the primary
  // service duration until the migration is run).
  let inserted = await supabaseAdmin
    .from("appointments").insert({ ...baseRow, duration_minutes: duration }).select("id, status, barber_id").single();
  if (inserted.error && /duration_minutes/.test(inserted.error.message)) {
    inserted = await supabaseAdmin
      .from("appointments").insert(baseRow).select("id, status, barber_id").single();
  }

  if (inserted.error) {
    // The DB unique index rejected an exact (barber, date, slot) race.
    if ((inserted.error as { code?: string }).code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: "That time was just booked — please pick another slot." }, { status: 409 });
    }
    return NextResponse.json({ error: "Couldn't create the booking. Please try again." }, { status: 500 });
  }

  // In-app notifications for the owner + assigned barber are created by
  // /api/appointments/notify-staff (called from the booking page), which is the
  // single source — and now entity-links them so they're inline-actionable.
  // (Creating one here too caused a duplicate owner notification.)

  return NextResponse.json({
    id: inserted.data.id,
    status: inserted.data.status,
    barber_id: inserted.data.barber_id,
  });
}
