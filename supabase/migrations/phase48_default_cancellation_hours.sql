-- Change the default cancellation window to 2 hours before the appointment.
--
-- The app default (DEFAULT_BOOKING in Settings → Booking) is now
-- cancellation_hours = 2 (was 24). This migration brings existing prod shops in
-- line so the confirmation email + text quote the right policy, while leaving any
-- owner who has deliberately customized their window alone.
--
-- Scope of the update (only the untouched-default cases — an owner who set some
-- OTHER value is left as-is, they can still change it in Settings → Booking):
--   1. shops whose booking_settings is null            → give them the full default object
--   2. shops missing the cancellation_hours key         → set it to 2
--   3. shops still on the old default of 24             → flip to 2
--
-- Run once in the Supabase SQL Editor. Idempotent.

-- 1. Shops with no booking_settings at all → seed the app default.
update public.shops
  set booking_settings = jsonb_build_object(
    'advance_days', 15,
    'cancellation_hours', 2,
    'no_show_protection', true,
    'auto_confirm', false,
    'slot_interval_minutes', 30
  )
  where booking_settings is null;

-- 2. Shops that have booking_settings but never set cancellation_hours → 2.
update public.shops
  set booking_settings = booking_settings || jsonb_build_object('cancellation_hours', 2)
  where booking_settings is not null
    and not (booking_settings ? 'cancellation_hours');

-- 3. Shops still carrying the OLD default (24) → new default (2).
--    Owners who chose a different number keep their choice.
update public.shops
  set booking_settings = booking_settings || jsonb_build_object('cancellation_hours', 2)
  where booking_settings is not null
    and (booking_settings->>'cancellation_hours') = '24';
