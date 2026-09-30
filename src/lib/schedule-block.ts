import { supabaseAdmin } from "@/lib/supabase-admin";

/** Minutes from "HH:MM" / "HH:MM:SS". */
function hmToMin(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Server-side "is this window blocked by the barber's SCHEDULE (not another
 * appointment)?" check. Mirrors exactly what /api/availability hides from the
 * customer, so a crafted or stale booking can't land on approved time-off or a
 * recurring break. The booking-conflict helpers cover appointment-vs-appointment
 * overlap; this covers the schedule side the DB overlap trigger never sees.
 * Returns a human-readable reason when blocked, else null.
 *
 * - `time_off_requests` (approved, covering `date`): a full day_off / vacation /
 *   sick blocks the whole day; blocked_hours blocks only its overlapping window.
 *   A null barber_id row is a shop-wide closure (applies to every barber).
 * - `barber_breaks` (recurring, by weekday): each break blocks its window.
 *   Only consulted when `includeBreaks` is true (customer-facing paths) — an
 *   owner adding a walk-in from the dashboard may deliberately book over a break.
 */
export async function scheduleBlockReason(
  shopId: string,
  barberId: string | null | undefined,
  date: string,
  startMin: number,
  endMin: number,
  opts?: { includeBreaks?: boolean },
): Promise<string | null> {
  if (!barberId) return null;

  const { data: offs } = await supabaseAdmin
    .from("time_off_requests")
    .select("type, start_time, end_time, barber_id")
    .eq("shop_id", shopId).eq("status", "approved")
    .lte("start_date", date).gte("end_date", date);
  const offHit = (offs ?? []).some((o) => {
    if (o.barber_id && o.barber_id !== barberId) return false; // other barber's block (null = shop-wide)
    if (o.type === "day_off" || o.type === "vacation" || o.type === "sick") return true;
    if (o.type === "blocked_hours" && o.start_time && o.end_time) {
      return startMin < hmToMin(o.end_time) && endMin > hmToMin(o.start_time);
    }
    return false;
  });
  if (offHit) return "That time is blocked for this barber. Please pick another time.";

  if (opts?.includeBreaks) {
    const dow = new Date(date + "T00:00:00").getDay();
    const { data: breaks } = await supabaseAdmin
      .from("barber_breaks").select("start_time, end_time")
      .eq("barber_id", barberId).eq("day_of_week", dow);
    const breakHit = (breaks ?? []).some(
      (b) => b.start_time && b.end_time && startMin < hmToMin(b.end_time) && endMin > hmToMin(b.start_time),
    );
    if (breakHit) return "That time falls during the barber's break. Please pick another time.";
  }

  return null;
}

/**
 * Is the barber WORKING (and taking bookings) for the whole [startMin, endMin)
 * window on `date`? The same rule /api/availability uses to offer times: the
 * weekday's available time_slots (widest window if several rows), an active,
 * non-paused barber. Returns a reason when not, else null.
 *
 * Customer-facing server paths must call this (via bookableReason) — the screen
 * only offers valid times, but a crafted request or an "Anyone" auto-pick must
 * not land on a day off or outside hours. Staff may deliberately book outside
 * hours, so staff paths opt out. A failed read is not treated as "closed" (the
 * other guards still apply) so a transient DB hiccup never blocks real customers.
 */
export async function workingHoursReason(
  barberId: string | null | undefined,
  date: string,
  startMin: number,
  endMin: number,
): Promise<string | null> {
  if (!barberId) return null;
  const dow = new Date(date + "T00:00:00").getDay();
  const [slotsRes, barberRes] = await Promise.all([
    supabaseAdmin.from("time_slots").select("start_time, end_time")
      .eq("barber_id", barberId).eq("day_of_week", dow).eq("is_available", true),
    supabaseAdmin.from("barbers").select("is_active, bookings_paused").eq("id", barberId).maybeSingle(),
  ]);
  const b = barberRes.data as { is_active?: boolean | null; bookings_paused?: boolean | null } | null;
  if (!barberRes.error && b && (b.is_active === false || b.bookings_paused === true)) {
    return "This barber isn't taking bookings right now. Please pick another barber.";
  }
  if (slotsRes.error) return null;
  const rows = (slotsRes.data ?? []).filter((s) => s.start_time && s.end_time);
  if (rows.length === 0) return "The barber isn't working that day. Please pick another day.";
  const open = Math.min(...rows.map((s) => hmToMin(s.start_time)));
  const close = Math.max(...rows.map((s) => hmToMin(s.end_time)));
  if (startMin < open || endMin > close) return "That time is outside the barber's working hours. Please pick another time.";
  return null;
}

/**
 * Everything the customer booking screen applies, enforced on the server: working
 * hours, active/not-paused, approved time-off / blocked hours, and breaks.
 */
export async function bookableReason(
  shopId: string,
  barberId: string | null | undefined,
  date: string,
  startMin: number,
  endMin: number,
): Promise<string | null> {
  return (await workingHoursReason(barberId, date, startMin, endMin))
    ?? (await scheduleBlockReason(shopId, barberId, date, startMin, endMin, { includeBreaks: true }));
}
