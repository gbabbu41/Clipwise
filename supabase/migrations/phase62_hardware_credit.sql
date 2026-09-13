-- Card-reader (Stripe Terminal) purchase incentive + interim request/approve flow.
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
--     hardware order, so — until the hardware-shop embed is GA and can fire a
--     purchase event — the credit runs through a MANUAL request/approve flow:
--     the barber requests it after buying, and the admin (super_admin) approves,
--     which applies the Stripe credit. This is also the correct security posture:
--     an owner can only REQUEST; only an admin can cause the actual credit.
--
-- State is derived from these columns (mutually exclusive — each transition nulls
-- the others' primary field):
--   • granted        → hardware_credit_granted = true         (credit applied)
--   • pending review  → hardware_credit_requested_at is set     (awaiting admin)
--   • rejected        → hardware_credit_rejected_at is set      (barber may re-request)
--   • none            → all null / false                        (can request)
alter table public.shops
  add column if not exists hardware_credit_granted        boolean not null default false,
  add column if not exists hardware_credit_amount_cents   integer,
  add column if not exists hardware_credit_at             timestamptz,
  -- Interim manual request/approve flow:
  add column if not exists hardware_credit_requested_at   timestamptz,
  add column if not exists hardware_credit_rejected_at    timestamptz,
  add column if not exists hardware_credit_note           text;
