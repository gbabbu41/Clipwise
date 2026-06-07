-- Phase 2 — save-card (off-session) support for far-future bookings.
--
-- Card auth holds expire ~7 days, so bookings more than 7 days out can't be
-- pre-authorized. Instead we save the customer's card at booking (Stripe
-- Checkout `setup` mode, no charge) and charge it off-session on completion /
-- no-show. That needs the Stripe Customer + PaymentMethod stored per row.
--
-- New payment_status value introduced by Phase 2: `saved`
--   (card on file, nothing charged yet). payment_status is a plain text
--   column with no CHECK constraint, so no enum migration is required.
alter table public.appointments
  add column if not exists stripe_customer_id text,        -- Stripe Customer holding the saved card
  add column if not exists stripe_payment_method_id text;  -- saved card to charge off-session later
