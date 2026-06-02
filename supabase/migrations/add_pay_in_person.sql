-- Adds shop-level toggle for letting customers pay in person at booking time.
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS allow_pay_in_person BOOLEAN NOT NULL DEFAULT TRUE;

-- Allow `payment_method = 'cash'` to coexist with `payment_status = 'unpaid'`
-- for bookings made with the pay-in-person option. Existing rows are
-- unaffected. No RLS changes — the existing shop_owner / barber policies
-- already permit updates to these columns.

COMMENT ON COLUMN shops.allow_pay_in_person IS
  'When true, customers see a "Pay in person at the shop" option at booking. When false, only online payment is offered.';
