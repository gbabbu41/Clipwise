// ── Barber-chair occupancy: the ONE source of truth ─────────────────────────
// "Is this time taken?" is answered identically everywhere by importing from
// here — the server conflict check (booking-conflict), /api/availability,
// /api/my-booking, and both the owner + customer calendars. It mirrors the DB
// overlap trigger (phase29/phase31) so the UI can never disagree with what the
// database will actually enforce on save.
//
// PURE + client-safe: no supabaseAdmin import, so client components can share it
// (server-only modules like supabase-admin must never be pulled into the browser).
import { occupiedSlots } from "@/lib/utils";

// Re-export the slot math so callers get occupancy rule + slot expansion from
// one module.
export { occupiedSlots };

export type SlotAppt = {
  status?: string | null;
  payment_status?: string | null;
  duration_minutes?: number | null;
  services?: { duration_minutes?: number } | { duration_minutes?: number }[] | null;
};

// Statuses that FREE the chair — the appointment no longer occupies its time.
// Matches the DB overlap trigger EXACTLY (phase29/phase31: a row frees the slot
// when `status in ('cancelled','no-show')`).
export const FREEING_STATUSES = ["cancelled", "no-show"];

// Positive list of occupying statuses, for SQL pre-filters
// (`.in("status", OCCUPYING_STATUSES)`). Over the real status domain
// (pending|confirmed|completed|cancelled|no-show) this is exactly
// "NOT IN FREEING_STATUSES".
export const OCCUPYING_STATUSES = ["pending", "confirmed", "completed"];

/**
 * THE truth: does this appointment currently hold its chair (block the slot)?
 * It occupies unless it's cancelled / no-show OR the money was refunded — a
 * completed booking still used its time, but a refunded one (even one checked
 * out early) frees it. The refund check is `!== "refunded"` (not a `.neq` query)
 * so a NULL payment_status (unpaid / in-person) is never wrongly freed.
 */
export function holdsSlot(a: SlotAppt): boolean {
  return !FREEING_STATUSES.includes(a.status ?? "") && a.payment_status !== "refunded";
}

/** Inverse of holdsSlot — the appointment no longer occupies its slot. */
export function freesSlot(a: SlotAppt): boolean {
  return !holdsSlot(a);
}

/**
 * The block length (minutes) an appointment occupies: its own duration_minutes
 * (set for multi-service bookings), else the linked service's duration, else 30.
 */
export function apptDuration(a: SlotAppt): number {
  if (a.duration_minutes && a.duration_minutes > 0) return a.duration_minutes;
  const svc = Array.isArray(a.services) ? a.services[0] : a.services;
  return svc?.duration_minutes ?? 30;
}
