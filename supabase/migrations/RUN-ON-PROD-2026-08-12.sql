-- ============================================================================
-- RUN ON PROD — consolidated pending migrations (2026-08-12)
-- ============================================================================
-- Paste this whole block into the Supabase SQL Editor and run it once. Every
-- statement is idempotent (uses `if not exists` / conditional updates), so it's
-- safe to run more than once. This bundles the five long-pending migrations plus
-- the Premium-plan fix. Until these run, the related features silently no-op
-- (the app degrades gracefully), so running this "activates" them on prod.
--
-- After running, you can delete this file — the individual phaseN_*.sql files
-- remain the canonical record.
-- ============================================================================

-- phase8: idempotent loyalty auto-award flag ---------------------------------
alter table public.appointments
  add column if not exists loyalty_awarded boolean default false;

-- phase13: when the money actually landed (for "Paid · X min ago") -----------
alter table public.appointments
  add column if not exists paid_at timestamptz;
update public.appointments
  set paid_at = created_at
  where paid_at is null
    and payment_status in ('paid', 'captured');

-- phase14: combined block length for multi-service bookings ------------------
alter table public.appointments
  add column if not exists duration_minutes integer;

-- phase49: permanent "has ever trialed" flag (stops trial restart) -----------
alter table public.shops
  add column if not exists trial_used boolean not null default false;
update public.shops
  set trial_used = true
  where trial_used = false
    and (
      trial_ends_at is not null
      or (subscription_status = 'active'
          and subscription_plan in ('pro','premium','business')
          and stripe_subscription_id is null)
    );

-- phase50: gift value applied per booking (avoid double-counting revenue) -----
alter table public.appointments
  add column if not exists gift_applied numeric not null default 0;

-- phase51: Premium plan = $79 + ensure multi_location feature -----------------
update public.plans
  set price_cents = 7900
  where id = 'premium';
update public.plans
  set features = (
    select array_agg(distinct f)
    from unnest(coalesce(features, '{}'::text[]) || '{multi_location}'::text[]) as f
  )
  where id = 'premium';

-- ============================================================================
-- Done. Verify:
--   select id, price_cents, features from public.plans where id = 'premium';
--   -- expect price_cents = 7900 and 'multi_location' in features
-- ============================================================================
