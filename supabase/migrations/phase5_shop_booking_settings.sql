-- Adds the shops.booking_settings JSONB column that the whole booking-policy
-- system depends on: no-show protection + fee, deposits, advance-booking window,
-- cancellation window, and auto-confirm. It's read by the booking page
-- (no-show hold/save + warning), the Settings → Booking save, the no-show cron,
-- and capture-appointment.
--
-- ⚠️ This column was missing in production, which caused:
--   · capture-appointment to 404 ("column shops.booking_settings does not exist")
--     so no-show / completion charges never went through,
--   · the no-show warning to never show + no card to actually be held/saved,
--   · Settings → Booking saves to fail.
--
-- Run this once in the Supabase SQL Editor. Idempotent.

alter table public.shops
  add column if not exists booking_settings jsonb;

-- Optional: give existing shops a sane default so no-show protection is on
-- (matches the app's DEFAULT_BOOKING). Comment out if you'd rather leave it null
-- and let each owner configure it from Settings → Booking.
update public.shops
  set booking_settings = jsonb_build_object(
    'no_show_protection', true,
    'no_show_fee_amount', 0,
    'auto_confirm', false,
    'advance_days', 30,
    'cancellation_hours', 24,
    'deposit', false,
    'deposit_amount', 10
  )
  where booking_settings is null;
