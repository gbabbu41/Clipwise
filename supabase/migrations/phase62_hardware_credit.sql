-- Card-reader (Stripe Terminal) purchase incentive.
--
-- Model (verified against Stripe's Connect/Terminal docs, Sept 2026):
--   • The barber buys the WisePad 3 DIRECTLY from Stripe (hardware-shop embedded
--     component on clipwise.ca). Stripe is the seller → the barber pays, gets the
--     tax invoice, and OWNS the reader. ClipWise never touches the hardware money,
--     stock, tax, or warranty (no reseller status needed).
--   • As the incentive, ClipWise credits the barber's OWN subscription by up to
--     50% of the reader price, capped at $50 (a Stripe customer balance credit on
--     the platform subscription — see src/lib/hardware-credit.ts).
--   • Stripe gives platforms NO reliable way to observe an account's self-placed
--     hardware order, so the credit is granted ONCE per shop, keyed on this flag,
--     from the hardware-shop purchase event when that goes live.
--
-- This column just makes the credit idempotent (granted at most once per shop).
alter table public.shops
  add column if not exists hardware_credit_granted   boolean not null default false,
  add column if not exists hardware_credit_amount_cents integer,
  add column if not exists hardware_credit_at         timestamptz;
