import { supabaseAdmin } from "@/lib/supabase-admin";
import { timeToMinutes } from "@/lib/utils";

/** Postgres unique-violation error code — raised by the double-booking index. */
export const UNIQUE_VIOLATION = "23505";

const SLOT_MIN = 30;

type ApptRow = {
  time_slot: string;
  services: { duration_minutes: number } | { duration_minutes: number }[] | null;
};

function durationOf(r: ApptRow): number {
  const s = Array.isArray(r.services) ? r.services[0] : r.services;
  return s?.duration_minutes ?? SLOT_MIN;
}

/** Active (pending/confirmed) appointments for a barber on a date, as
 *  [startMin, endMin) minute intervals — end derived from the service duration. */
async function barberIntervals(barber_id: string, date: string): Promise<[number, number][]> {
  const { data } = await supabaseAdmin
    .from("appointments")
    .select("time_slot, services(duration_minutes)")
    .eq("barber_id", barber_id)
    .eq("date", date)
    .in("status", ["pending", "confirmed"]);
  return (data ?? []).map((r) => {
    const start = timeToMinutes((r as ApptRow).time_slot);
    return [start, start + durationOf(r as ApptRow)] as [number, number];
  });
}

/**
 * True if the half-open interval [startMin, endMin) overlaps any active
 * appointment of this barber on `date`. Unlike the exact-start-slot check, this
 * catches a new booking that falls *inside* a longer existing appointment (and
 * vice-versa) — the duration-overlap the DB unique index alone can't see.
 */
export async function barberHasConflict(
  barber_id: string | null | undefined,
  date: string,
  startMin: number,
  endMin: number,
): Promise<boolean> {
  if (!barber_id) return false;
  const intervals = await barberIntervals(barber_id, date);
  return intervals.some(([s, e]) => startMin < e && s < endMin);
}

/**
 * Pick an active barber of this shop who is free for [startMin, endMin).
 * `preferredId` (e.g. the one the client tentatively chose) is tried first.
 * Returns null when every barber is busy — used to resolve an "Any Available"
 * booking to a concrete barber server-side so the DB unique index protects it.
 */
export async function findAvailableBarber(
  shop_id: string,
  date: string,
  startMin: number,
  endMin: number,
  preferredId?: string | null,
): Promise<string | null> {
  const { data: barbers } = await supabaseAdmin
    .from("barbers").select("id").eq("shop_id", shop_id).eq("is_active", true);
  const ids = (barbers ?? []).map((b) => b.id as string);
  const ordered = preferredId ? [preferredId, ...ids.filter((i) => i !== preferredId)] : ids;
  for (const id of ordered) {
    if (!(await barberHasConflict(id, date, startMin, endMin))) return id;
  }
  return null;
}

/**
 * Returns true if booking `barber_id` at `time_slot` on `date` would
 * double-book them. Duration-aware on the *existing* side (an existing long
 * appointment that covers this slot counts as a clash). Kept for callers that
 * only know the start slot; prefer barberHasConflict when the new service's
 * duration is known.
 */
export async function barberSlotTaken(
  barber_id: string | null | undefined,
  date: string,
  time_slot: string,
): Promise<boolean> {
  if (!barber_id) return false;
  const start = timeToMinutes(time_slot);
  return barberHasConflict(barber_id, date, start, start + SLOT_MIN);
}
