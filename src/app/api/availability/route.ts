import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

function durationOf(r: { duration_minutes?: number | null; services: { duration_minutes?: number } | { duration_minutes?: number }[] | null }): number {
  if (r.duration_minutes && r.duration_minutes > 0) return r.duration_minutes;
  const s = Array.isArray(r.services) ? r.services[0] : r.services;
  return s?.duration_minutes ?? 30;
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
  const { data: barbers } = await barbersQ.order("name");
  const barberIds = (barbers ?? []).map(b => b.id as string);
  if (barberIds.length === 0) return NextResponse.json({ barbers: [] });

  // Working hours for the weekday + active appointments + approved time-off.
  // The appointment query is resilient to duration_minutes not existing (pre-phase14).
  const apptWithDur = await supabaseAdmin
    .from("appointments")
    .select("barber_id, time_slot, duration_minutes, services(duration_minutes)")
    .eq("shop_id", shop_id).eq("date", date).in("status", ["pending", "confirmed"]);
  const apptRows = apptWithDur.error
    ? ((await supabaseAdmin
        .from("appointments")
        .select("barber_id, time_slot, services(duration_minutes)")
        .eq("shop_id", shop_id).eq("date", date).in("status", ["pending", "confirmed"])).data ?? [])
    : (apptWithDur.data ?? []);

  const [{ data: slots }, { data: timeOff }] = await Promise.all([
    supabaseAdmin.from("time_slots").select("barber_id, start_time, end_time, is_available")
      .in("barber_id", barberIds).eq("day_of_week", dow).eq("is_available", true),
    supabaseAdmin.from("time_off_requests").select("barber_id, type, start_time, end_time")
      .eq("shop_id", shop_id).eq("status", "approved").lte("start_date", date).gte("end_date", date),
  ]);

  const slotByBarber = new Map<string, { start_time: string; end_time: string }>();
  (slots ?? []).forEach(s => slotByBarber.set(s.barber_id as string, { start_time: s.start_time as string, end_time: s.end_time as string }));

  const busyByBarber = new Map<string, Busy[]>();
  (apptRows as { barber_id: string; time_slot: string; duration_minutes?: number | null; services: { duration_minutes?: number } | { duration_minutes?: number }[] | null }[])
    .forEach(a => {
      const arr = busyByBarber.get(a.barber_id) ?? [];
      arr.push({ time_slot: a.time_slot, duration: durationOf(a) });
      busyByBarber.set(a.barber_id, arr);
    });

  const offByBarber = new Map<string, { fullDayOff: boolean; blocked: { start_time: string; end_time: string }[] }>();
  (timeOff ?? []).forEach(o => {
    const cur = offByBarber.get(o.barber_id as string) ?? { fullDayOff: false, blocked: [] };
    if (o.type === "day_off" || o.type === "vacation" || o.type === "sick") cur.fullDayOff = true;
    else if (o.type === "blocked_hours" && o.start_time && o.end_time) cur.blocked.push({ start_time: o.start_time as string, end_time: o.end_time as string });
    offByBarber.set(o.barber_id as string, cur);
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
