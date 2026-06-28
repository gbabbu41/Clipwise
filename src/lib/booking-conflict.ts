import { supabaseAdmin } from "@/lib/supabase-admin";
import { timeToMinutes } from "@/lib/utils";

/** Postgres unique-violation error code — raised by the double-booking index. */
export const UNIQUE_VIOLATION = "23505";

/** True when an insert/update was rejected by the DB overlap guard (phase18
 *  trigger) OR the exact-slot unique index — i.e. it would double-book a barber. */
export function isDoubleBookError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === UNIQUE_VIOLATION || err.code === "P0001" || /OVERLAP/i.test(err.message ?? "");
}

const SLOT_MIN = 30;

// Statuses that actually HOLD a chair. A completed appointment still occupied
// its time, so it blocks an overlap too — only cancelled / no-show free the slot
// (matching the calendar's isDimmed() occupancy). Keep this in sync with the
// phase18 DB trigger and /api/availability.
const OCCUPYING_STATUSES = ["pending", "confirmed", "completed"];

type ApptRow = {
  time_slot: string;
  duration_minutes?: number | null;
  services: { duration_minutes: number } | { duration_minutes: number }[] | null;
};

function durationOf(r: ApptRow): number {
  // Prefer the appointment's own block length (set for multi-service bookings);
  // fall back to the linked service's duration for single-service rows.
  if (r.duration_minutes && r.duration_minutes > 0) return r.duration_minutes;
  const s = Array.isArray(r.services) ? r.services[0] : r.services;
  return s?.duration_minutes ?? SLOT_MIN;
}

/** Active (pending/confirmed) appointments for a barber on a date, as
 *  [startMin, endMin) minute intervals — end derived from the appointment's
 *  duration. Resilient to the `duration_minutes` column not existing yet
 *  (pre-phase14): on that error it retries without it and falls back to the
 *  linked service's duration. Critically, this means a missing migration can
 *  never silently disable conflict detection. */
async function barberIntervals(barber_id: string, date: string, excludeId?: string | null): Promise<[number, number][]> {
  let rows: (ApptRow & { id: string })[];
  const withDur = await supabaseAdmin
    .from("appointments")
    .select("id, time_slot, duration_minutes, services(duration_minutes)")
    .eq("barber_id", barber_id)
    .eq("date", date)
    .in("status", OCCUPYING_STATUSES);
  if (withDur.error) {
    const fallback = await supabaseAdmin
      .from("appointments")
      .select("id, time_slot, services(duration_minutes)")
      .eq("barber_id", barber_id)
      .eq("date", date)
      .in("status", OCCUPYING_STATUSES);
    rows = (fallback.data ?? []) as (ApptRow & { id: string })[];
  } else {
    rows = (withDur.data ?? []) as (ApptRow & { id: string })[];
  }
  return rows
    .filter((r) => !excludeId || r.id !== excludeId)   // ignore the appointment being edited
    .map((r) => {
      const start = timeToMinutes(r.time_slot);
      return [start, start + durationOf(r)] as [number, number];
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
  excludeId?: string | null,   // appointment to ignore (e.g. the one being edited)
): Promise<boolean> {
  if (!barber_id) return false;
  const intervals = await barberIntervals(barber_id, date, excludeId);
  return intervals.some(([s, e]) => startMin < e && s < endMin);
}

/**
 * Pick an active barber of this shop who is free for [startMin, endMin).
 * `preferredId` (e.g. the one the client tentatively chose) is tried first.
 * Returns null when every barber is busy — used to resolve an "Any Available"
 * booking to a concrete barber server-side so the DB unique index protects it.
 * Fetches all barbers' appointments in a single query instead of O(n) sequential calls.
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
  if (ordered.length === 0) return null;

  // Single round-trip: fetch all active appointments for all barbers on this date.
  type RowWithBarber = ApptRow & { barber_id: string };
  const withDur = await supabaseAdmin
    .from("appointments")
    .select("barber_id, time_slot, duration_minutes, services(duration_minutes)")
    .in("barber_id", ordered).eq("date", date).in("status", OCCUPYING_STATUSES);
  let allRows: RowWithBarber[];
  if (withDur.error) {
    const fallback = await supabaseAdmin
      .from("appointments")
      .select("barber_id, time_slot, services(duration_minutes)")
      .in("barber_id", ordered).eq("date", date).in("status", OCCUPYING_STATUSES);
    allRows = (fallback.data ?? []) as RowWithBarber[];
  } else {
    allRows = (withDur.data ?? []) as RowWithBarber[];
  }

  // Group intervals by barber in memory.
  const intervalsByBarber = new Map<string, [number, number][]>();
  for (const r of allRows) {
    const arr = intervalsByBarber.get(r.barber_id) ?? [];
    const s = timeToMinutes(r.time_slot);
    arr.push([s, s + durationOf(r)]);
    intervalsByBarber.set(r.barber_id, arr);
  }

  for (const id of ordered) {
    const intervals = intervalsByBarber.get(id) ?? [];
    if (!intervals.some(([s, e]) => startMin < e && s < endMin)) return id;
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
