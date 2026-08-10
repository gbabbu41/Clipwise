-- Fix: the free trial could be restarted forever. The old guard checked
-- shops.trial_ends_at, but that field is nulled when a trial ends (cron) or is
-- cancelled — so it kept passing. Add a PERMANENT "has ever trialed" flag that
-- is set on the first trial and never cleared.
--
-- Run once in the Supabase SQL Editor. Idempotent.

alter table public.shops
  add column if not exists trial_used boolean not null default false;

-- Backfill: any shop that is currently (or was ever) on a trial has used it.
-- A shop with a trial_ends_at set, OR one that's active on a paid plan with no
-- Stripe subscription (a no-card trial), counts as having trialed.
update public.shops
  set trial_used = true
  where trial_used = false
    and (
      trial_ends_at is not null
      or (subscription_status = 'active'
          and subscription_plan in ('pro','premium','business')
          and stripe_subscription_id is null)
    );
