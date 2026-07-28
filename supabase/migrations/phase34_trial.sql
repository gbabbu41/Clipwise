-- phase34_trial.sql
-- 21-day, no-card free trial for Pro/Premium. A shop on trial is stored as:
--   subscription_status = 'active'  (so plan gating already grants the features)
--   trial_ends_at       = now + 21 days
--   stripe_subscription_id = NULL   (no card yet — this is what marks it a TRIAL
--                                    vs a real paid subscription)
-- When they add a card (subscribe), stripe_subscription_id is set + trial_ends_at
-- cleared. A daily cron downgrades trials whose trial_ends_at has passed with no
-- subscription. Only one new column is needed.
--
-- Safe to run multiple times.

alter table public.shops
  add column if not exists trial_ends_at timestamptz;

-- Partial index for the daily cron's "trials ending / expired" scan.
create index if not exists shops_trial_ends_at_idx
  on public.shops(trial_ends_at) where trial_ends_at is not null;
