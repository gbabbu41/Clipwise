-- ============================================================
-- Phase 8: Loyalty earning + redemption
-- Points are auto-awarded when an appointment is completed.
-- loyalty_awarded flag makes the award idempotent (no double-credit).
-- Redemption + manual adjustments are logged to loyalty_rewards
-- (action: 'earned' | 'added' | 'redeemed').
-- ============================================================

alter table public.appointments
  add column if not exists loyalty_awarded boolean default false;
