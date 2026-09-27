-- Cache each online-booking charge's EXACT Stripe fee on the appointment.
--
-- Charges taken at booking (Stripe Checkout / saved card) have no transactions
-- row, so until now their fee was only ever fetched live from Stripe — a few per
-- page load, never saved. A shop with many online bookings would see Payments
-- and the Dashboard fall back to a "≈" estimate. The balance transaction a charge
-- creates never changes (refunds post separately), so it's safe to store once.
--
-- NULL = not confirmed yet (the app looks it up and fills it). Filled by the
-- payment_intent.succeeded webhook, the Payments fee check, and the daily cron.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS stripe_fee numeric(10,2);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS stripe_gross numeric(10,2);
