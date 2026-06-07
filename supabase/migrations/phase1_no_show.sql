-- Phase 1 — no-show / card-hold support.
-- payment_intent_id and payment_status already exist on appointments.
-- payment_status values used by Phase 1: held | captured | failed
--   (existing values paid | unpaid | pending | refunded stay valid).
alter table public.appointments
  add column if not exists no_show_fee_amount integer; -- cents actually captured for a no-show
