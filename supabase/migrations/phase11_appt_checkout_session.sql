-- ============================================================
-- Phase 11: store the Stripe Checkout session id on appointments
-- ============================================================
-- Lets the app reconcile a payment-link payment against Stripe even when the
-- customer never lands back on the success page and the webhook didn't fire
-- (the payment-link sync gap). /api/stripe/reconcile-payments looks up unpaid
-- appointments that have a session id and flips them to paid when Stripe says so.
-- ============================================================
alter table public.appointments
  add column if not exists stripe_checkout_session_id text;
