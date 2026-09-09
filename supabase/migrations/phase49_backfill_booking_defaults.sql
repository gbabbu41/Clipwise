-- Backfill the FULL default booking policy onto shops whose booking_settings was
-- created with only a partial object (a regression in /api/shops/create that wrote
-- just { loyalty, reminders }).
--
-- Why this matters: the customer booking page reads no_show_protection with a
-- plain truthiness check (`!!settings.no_show_protection`), and online payment is
-- gated on it (`canPayOnlineNow = total>0 && shopCanCharge && no_show_protection`).
-- A shop missing that key therefore reads as no_show_protection = OFF and can NOT
-- take online payments — even though Settings → Booking shows the toggle ON (it
-- merges the app default). This silently disabled online payments for brand-new
-- PAID shops. Persisting the full default makes the DB match what the owner sees.
--
-- Safe / idempotent: we build the default object and merge the EXISTING settings
-- ON TOP (`defaults || booking_settings`), so any value an owner explicitly chose
-- WINS and only genuinely-absent keys are filled. Scoped to shops that are missing
-- no_show_protection, i.e. exactly the partially-seeded rows — a shop that has the
-- key is left untouched. Run once in the Supabase SQL Editor.

update public.shops
set booking_settings =
  jsonb_build_object(
    'advance_days', 15,
    'cancellation_hours', 2,
    'no_show_protection', true,
    'no_show_fee_percent', 50,
    'pin_requires_card', true,
    'auto_confirm', false,
    'slot_interval_minutes', 30,
    'tips_enabled', true,
    'loyalty', jsonb_build_object('enabled', false),
    'reminders', jsonb_build_object('appointment_24h', true)
  ) || coalesce(booking_settings, '{}'::jsonb)
where not (coalesce(booking_settings, '{}'::jsonb) ? 'no_show_protection');
