import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Returns true if an ACTIVE appointment (pending/confirmed) already exists for
 * this barber at this exact date + start slot — i.e. booking it would
 * double-book the barber. Mirrors the DB unique index in
 * phase4_prevent_double_booking.sql; used for a friendly pre-check so the
 * customer/owner gets a clear "that time was just taken" instead of a raw
 * constraint error (and, for online, so they never pay for a lost slot).
 *
 * "Any barber" (barber_id null) can't be uniquely held, so it's never a
 * conflict here — those bookings fall back to app-level availability.
 */
export async function barberSlotTaken(
  barber_id: string | null | undefined,
  date: string,
  time_slot: string,
): Promise<boolean> {
  if (!barber_id) return false;
  const { data } = await supabaseAdmin
    .from("appointments")
    .select("id")
    .eq("barber_id", barber_id)
    .eq("date", date)
    .eq("time_slot", time_slot)
    .in("status", ["pending", "confirmed"])
    .limit(1)
    .maybeSingle();
  return !!data;
}

/** Postgres unique-violation error code — raised by the double-booking index. */
export const UNIQUE_VIOLATION = "23505";
