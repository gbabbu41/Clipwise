-- ============================================================
-- Phase 10: let the trusted backend apply subscription changes
-- ============================================================
-- Bug: billing upgrades did nothing. prevent_shop_field_escalation() raises on
-- ANY shops.subscription_plan / status change unless is_super_admin(). The
-- Stripe webhook + the new /api/stripe/confirm-subscription route run with the
-- service-role key, whose auth.uid() is NULL → treated as a non-admin → the
-- subscription_plan UPDATE is rejected, so starter→pro never applies. (Onboarding
-- only worked because the plan is set at INSERT, which this BEFORE-UPDATE trigger
-- doesn't touch.)
--
-- Fix: only enforce the escalation guard for a REAL authenticated user
-- (auth.uid() IS NOT NULL). When auth.uid() is NULL the caller is the trusted
-- service-role backend (the only context that can update shops with a null uid —
-- RLS shops_update_owner requires owner_id = auth.uid(), so an anon client can't
-- update any shop). A logged-in owner still cannot self-upgrade.
-- ============================================================
create or replace function public.prevent_shop_field_escalation()
returns trigger language plpgsql security definer as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    if old.status is distinct from new.status then
      raise exception 'Permission denied: shop status can only be changed by an administrator';
    end if;
    if old.subscription_plan is distinct from new.subscription_plan then
      raise exception 'Permission denied: subscription plan can only be changed by an administrator';
    end if;
    if old.owner_id is distinct from new.owner_id then
      raise exception 'Permission denied: cannot transfer shop ownership';
    end if;
  end if;
  return new;
end;
$$;
