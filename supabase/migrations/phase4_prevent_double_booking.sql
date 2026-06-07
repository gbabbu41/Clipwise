-- Prevent double-booking: no two ACTIVE appointments may share the same
-- barber + date + start time. This is the authoritative guard — it holds even
-- if two customers check out at the exact same moment (the client-side slot
-- grid can't win that race; the database can).
--
-- Scope of the rule (deliberately narrow so legitimate bookings still work):
--   · only ACTIVE statuses (pending, confirmed) block a slot. A cancelled /
--     no-show / completed appointment frees the slot for re-booking.
--   · only when a specific barber is assigned (barber_id not null). "Any
--     barber" rows can't be uniquely constrained and are left to the app.
--   · key is (barber_id, date, time_slot) — the exact start slot. Multi-service
--     bookings use DIFFERENT back-to-back time_slots, so they don't collide;
--     recurring bookings use DIFFERENT dates. (Note: this does NOT stop a
--     longer service from OVERLAPPING a later slot — that stays an app-level
--     availability concern. It stops the common "two bookings, same start".)
--
-- Run this once in the Supabase SQL Editor.
--
-- ⚠️ If you already have duplicate ACTIVE rows, the CREATE INDEX will fail.
-- Find them first with:
--   select barber_id, date, time_slot, count(*)
--   from public.appointments
--   where status in ('pending','confirmed') and barber_id is not null
--   group by barber_id, date, time_slot having count(*) > 1;
-- ...then cancel/delete the extras before running the index below.

create unique index if not exists appointments_no_double_booking
  on public.appointments (barber_id, date, time_slot)
  where status in ('pending', 'confirmed') and barber_id is not null;
