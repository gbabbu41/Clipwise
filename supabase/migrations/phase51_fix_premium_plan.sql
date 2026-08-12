-- phase51_fix_premium_plan.sql
-- Align the Premium plan row with its intended pricing + entitlements.
--
--  1. Price: the phase9 seed set Premium to 4900 ($49), but the code
--     (PLAN_PRICING in lib/stripe.ts + DEFAULT_PLAN_CONFIG in lib/validation.ts)
--     and every comment treat Premium as $79. The DB row is what's actually
--     charged, so bring it to 7900 ($79). (Owner confirmed $79, 2026-08-12.)
--  2. Feature: ensure the Premium `features` array includes 'multi_location'
--     so the admin view matches the entitlement. The app now also gates
--     multi-location on the location LIMIT (getLocationLimit > 1), so this is
--     belt-and-suspenders — but keeps the plans table honest.
--
-- Run once in the Supabase SQL Editor. Idempotent (safe to run repeatedly).

update public.plans
  set price_cents = 7900
  where id = 'premium';

update public.plans
  set features = (
    select array_agg(distinct f)
    from unnest(coalesce(features, '{}'::text[]) || '{multi_location}'::text[]) as f
  )
  where id = 'premium';
