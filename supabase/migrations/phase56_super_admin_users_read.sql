-- phase56 — Super admin can read the full user directory.
--
-- Symptom: the admin "Users" page showed 1 of 36 users (every filter tab read 0).
-- Cause: the users SELECT policy filtered to the caller's own row with NO
-- super-admin branch — unlike appointments/shops/clients/plans, which all carry
-- `or public.is_super_admin()`. The page queries users with the admin's own JWT,
-- RLS trims it to their one row, so exactly one user renders.
--
-- SELECT-ONLY. The UPDATE policies are deliberately left untouched — broadening
-- user UPDATE is the privilege-escalation surface locked down in phase54.

-- 1) Ensure the helper is SECURITY DEFINER with a fixed search_path, so calling it
--    from a policy ON public.users bypasses RLS on users (no infinite recursion).
create or replace function public.is_super_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists(select 1 from public.users where id = auth.uid() and role = 'super_admin');
$$;

-- 2) Add the super-admin read branch to the users SELECT policy (matches the
--    pattern already on every other table). Everyone still sees only their own row.
drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users for select using (
  auth.uid() = id or public.is_super_admin()
);

-- 3) Belt-and-suspenders: a dedicated super-admin SELECT policy too (permissive,
--    OR'd with the above), so the admin directory works even if another SELECT
--    policy is present. SELECT only.
drop policy if exists "users_select_admin" on public.users;
create policy "users_select_admin" on public.users for select using (
  public.is_super_admin()
);

-- 4) Data hygiene: a rejected shop should not keep an "active" subscription row
--    (it lingered in MRR before the dashboard fix). Deactivate any stale ones.
update public.shops
   set subscription_status = 'cancelled', trial_ends_at = null
 where status = 'rejected' and subscription_status = 'active';
