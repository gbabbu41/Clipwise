import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { OCCUPYING_STATUSES, holdsSlot, apptDuration } from "@/lib/availability";

/**
 * Public availability for the customer booking page.
 *
 * The booking page is anonymous, but the `appointments` / `time_off_requests`
 * RLS policies are stakeholder-only — so a direct client query returns ZERO
 * rows and every slot looks free (→ double-booking). This route reads the real
 * data with the service-role client and returns ONLY what's needed to compute
 * availability (working hours, busy time-ranges, time-off) — never any customer
 * PII (no names / emails / phones).
 *
 * Returns, per active barber:
 *   { id, name, start_time, end_time, fullDayOff, busy: [{time_slot, duration}], blocked: [{start_time,end_time}] }
 */
type Busy = { time_slot: string; duration: number };

type ApptRow = { barber_id: string; time_slot: string; duration_minutes?: number | null; payment_status?: string | null; services: { duration_minutes?: number } | { duration_minutes?: number }[] | null };

// The day's active appointments, with a fallback that omits duration_minutes if
// that column doesn't exist yet (pre-phase14). `failed` is true only on a real
// (non-migration) error so the caller can 500.
async function loadAppointments(shopId: string, date: string): Promise<{ rows: ApptRow[]; failed: boolean }> {
  const withDur = await supabaseAdmin
    .from("appointments")
    .select("barber_id, time_slot, duration_minutes, payment_status, services(duration_minutes)")
    .eq("shop_id", shopId).eq("date", date).in("status", OCCUPYING_STATUSES);
  if (!withDur.error) return { rows: (withDur.data ?? []) as ApptRow[], failed: false };
  if (withDur.error.message?.includes("duration_minutes")) {
    const fallback = await supabaseAdmin
      .from("appointments")
      .select("barber_id, time_slot, payment_status, services(duration_minutes)")
      .eq("shop_id", shopId).eq("date", date).in("status", OCCUPYING_STATUSES);
    return { rows: (fallback.data ?? []) as ApptRow[], failed: false };
  }
  return { rows: [], failed: true };
}

export async function POST(request: NextRequest) {
  const { shop_id, date, barber_id } = await request.json() as {
    shop_id: string; date: string; barber_id?: string | null;
  };
  if (!shop_id || !date) return NextResponse.json({ error: "Missing shop_id or date" }, { status: 400 });

  const dow = new Date(date + "T00:00:00").getDay();

  // Active barbers (optionally just the one the customer picked).
  let barbersQ = supabaseAdmin.from("barbers").select("id, name").eq("shop_id", shop_id).eq("is_active", true);
  if (barber_id) barbersQ = barbersQ.eq("id", barber_id);

  // These three reads don't depend on each other — barbers, the paused set, and
  // the day's appointments all key off shop_id/date. Run them together instead
  // of as a serial waterfall: this is the hottest anonymous endpoint (hit on
  // every date/barber tap), so the saved round-trips matter. The `paused` query
  // is error-tolerant so a shop pre-phase15 (no bookings_paused column) still
  // returns availability normally.
  const [barbersRes, pausedRes, apptResult] = await Promise.all([
    barbersQ.order("name"),
    supabaseAdmin.from("barbers").select("id").eq("shop_id", shop_id).eq("bookings_paused", true),
    loadAppointments(shop_id, date),
  ]);
  if (apptResult.failed) return NextResponse.json({ error: "Failed to load appointments" }, { status: 500 });

  const pausedIds = new Set((pausedRes.error ? [] : (pausedRes.data ?? [])).map(b => b.id as string));
  const barbers = (barbersRes.data ?? []).filter(b => !pausedIds.has(b.id as string));

  const barberIds = barbers.map(b => b.id as string);
  if (barberIds.length === 0) return NextResponse.json({ barbers: [] });

  // A refunded booking (even one checked out early → completed, then refunded)
  // no longer holds its slot — drop it so the time reads as free everywhere.
  const apptRows = apptResult.rows.filter(holdsSlot);

  const [{ data: slots }, { data: timeOff }, { data: breaks }] = await Promise.all([
    supabaseAdmin.from("time_slots").select("barber_id, start_time, end_time, is_available")
      .in("barber_id", barberIds).eq("day_of_week", dow).eq("is_available", true),
    supabaseAdmin.from("time_off_requests").select("barber_id, type, start_time, end_time")
      .eq("shop_id", shop_id).eq("status", "approved").lte("start_date", date).gte("end_date", date),
    supabaseAdmin.from("barber_breaks").select("barber_id, start_time, end_time")
      .in("barber_id", barberIds).eq("day_of_week", dow),
  ]);

  const slotByBarber = new Map<string, { start_time: string; end_time: string }>();
  (slots ?? []).forEach(s => {
    const cur = slotByBarber.get(s.barber_id as string);
    const start = s.start_time as string;
    const end = s.end_time as string;
    // If a barber somehow has >1 row for this weekday, use the WIDEST window
    // (earliest start, latest end) instead of arbitrarily keeping one — which
    // could otherwise hide early/late hours (string compare works for HH:MM:SS).
    if (!cur) slotByBarber.set(s.barber_id as string, { start_time: start, end_time: end });
    else slotByBarber.set(s.barber_id as string, {
      start_time: start < cur.start_time ? start : cur.start_time,
      end_time: end > cur.end_time ? end : cur.end_time,
    });
  });

  const busyByBarber = new Map<string, Busy[]>();
  apptRows.forEach(a => {
    const arr = busyByBarber.get(a.barber_id) ?? [];
    arr.push({ time_slot: a.time_slot, duration: apptDuration(a) });
    busyByBarber.set(a.barber_id, arr);
  });

  const offByBarber = new Map<string, { fullDayOff: boolean; blocked: { start_time: string; end_time: string }[] }>();
  function applyOff(bid: string, o: { type: string | null; start_time: string | null; end_time: string | null }) {
    const cur = offByBarber.get(bid) ?? { fullDayOff: false, blocked: [] };
    if (o.type === "day_off" || o.type === "vacation" || o.type === "sick") cur.fullDayOff = true;
    else if (o.type === "blocked_hours" && o.start_time && o.end_time) cur.blocked.push({ start_time: o.start_time, end_time: o.end_time });
    offByBarber.set(bid, cur);
  }
  (timeOff ?? []).forEach(o => {
    if (o.barber_id === null) {
      // Shop-wide closure — apply to every active barber.
      barberIds.forEach(bid => applyOff(bid, o));
    } else {
      applyOff(o.barber_id as string, o);
    }
  });
  // Recurring breaks/lunch behave like blocked ranges for the day.
  (breaks ?? []).forEach(b => {
    const cur = offByBarber.get(b.barber_id as string) ?? { fullDayOff: false, blocked: [] };
    cur.blocked.push({ start_time: b.start_time as string, end_time: b.end_time as string });
    offByBarber.set(b.barber_id as string, cur);
  });

  const result = (barbers ?? []).map(b => {
    const wh = slotByBarber.get(b.id as string);
    const off = offByBarber.get(b.id as string) ?? { fullDayOff: false, blocked: [] };
    return {
      id: b.id,
      name: b.name,
      start_time: wh?.start_time ?? null,
      end_time: wh?.end_time ?? null,
      fullDayOff: off.fullDayOff,
      busy: busyByBarber.get(b.id as string) ?? [],
      blocked: off.blocked,
    };
  });

  return NextResponse.json({ barbers: result });
}
