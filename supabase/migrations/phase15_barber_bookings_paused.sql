-- Per-barber "pause online bookings" switch (Schedule page header toggle).
-- A paused barber is excluded from /api/availability (no bookable slots) so
-- customers can't book them, while the rest of the shop stays bookable.
ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS bookings_paused boolean NOT NULL DEFAULT false;
