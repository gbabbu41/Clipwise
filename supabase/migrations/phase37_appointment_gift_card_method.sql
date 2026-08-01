-- Phase 37 — allow 'gift_card' as an appointment payment method.
-- A booking fully covered by a gift card is marked paid by gift card, but the
-- payment_method CHECK previously only allowed card/cash/online, so that update
-- was rejected and the booking stayed unpaid ("pay in person"). Widen it.
-- Safe to run repeatedly.

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_payment_method_check;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_payment_method_check
  CHECK (payment_method IN ('card', 'cash', 'online', 'gift_card'));
