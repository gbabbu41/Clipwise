-- Fix: a gift card redeemed on a BOOKING was counted as revenue twice — once
-- when the card was sold, and again as part of the appointment's full total.
-- (POS already handles this correctly by recording the sale net of the gift.)
--
-- Store how much gift-card value was applied to each appointment so the revenue
-- math can subtract it (count the gift once, at sale). total_amount stays the
-- FULL price for the receipt; only the counted revenue excludes the gift part.
--
-- Going-forward only: historical gift bookings can't be reliably reconstructed,
-- so old rows keep gift_applied = 0 (unchanged). Run once. Idempotent.

alter table public.appointments
  add column if not exists gift_applied numeric not null default 0;
