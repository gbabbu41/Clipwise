-- Phase 38: real Stripe processing fee per transaction.
--
-- Barbers and the shop split the card-processing fee 50/50. To split the REAL
-- fee (not an estimate), we store the actual fee Stripe charged on each card
-- payment — read from the charge's balance_transaction on the shop's connected
-- account at payment time. Cash/in-person sales have no fee (stays 0).
--
-- Safe to run repeatedly. Existing rows default to 0 (no fee split applied to
-- history — only payments taken after this ships carry a real fee).
alter table public.transactions
  add column if not exists stripe_fee numeric not null default 0;
