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
