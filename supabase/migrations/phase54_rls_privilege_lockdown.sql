-- phase54 — RLS privilege lockdown (CRITICAL security fixes)
-- STATUS: PENDING — authored while the Supabase tool was offline. Run this in the
-- Supabase SQL editor, or Claude applies + verifies via MCP once it reconnects.
-- Verified safe against the app code (no legit flow depends on the removed policies).

-- ── 1) Privilege escalation → super_admin ─────────────────────────────────────
-- users has TWO permissive UPDATE policies, which Postgres OR-s together:
--   protect_admin_role  WITH CHECK (role <> 'super_admin')     -- tries to block it
--   users_update_own    WITH CHECK (NULL → falls back to USING: own row)  -- lets it through
-- A NULL WITH CHECK on an UPDATE policy reuses its USING (true for your own row), so
-- users_update_own approves ANY column change on your own row — including role. Because
-- the two are OR-ed, passing users_update_own bypasses protect_admin_role entirely: any
-- signed-in user could set role='super_admin' on themselves. is_super_admin() gates 20+
-- policies, so that's a full platform takeover in one UPDATE.
-- Fix: a RESTRICTIVE policy is AND-ed with every permissive UPDATE, so it can't be
-- OR-bypassed. No update may leave role='super_admin' unless the caller already is one
-- (the service role bypasses RLS for legitimate admin operations).
DROP POLICY IF EXISTS users_no_self_elevate ON public.users;
CREATE POLICY users_no_self_elevate ON public.users
  AS RESTRICTIVE FOR UPDATE
  USING (true)
  WITH CHECK (role IS DISTINCT FROM 'super_admin' OR is_super_admin());

-- ── 2) Uninvited barber self-registration → cross-tenant breach ───────────────
-- barbers_self_register let ANY authenticated user INSERT a barber row at any approved
-- shop, and barbers.is_active DEFAULTS true — so the row immediately satisfies the staff
-- policies (read that shop's clients + PII, transactions, messages; write appointments;
-- edit schedules). Sign up → one INSERT → you are staff at any shop.
-- Legit onboarding never needs this policy: register_barber() (SECURITY DEFINER — checks
-- auth + shop approval, inserts is_active=false) and the accept-invite route (service
-- role) both bypass RLS. Remove the self-register hole; allow only a shop OWNER to add
-- staff to their OWN shop directly. Everyone else goes through the RPC.
DROP POLICY IF EXISTS barbers_self_register ON public.barbers;
DROP POLICY IF EXISTS barbers_insert_owner ON public.barbers;
CREATE POLICY barbers_insert_owner ON public.barbers
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.shops s WHERE s.id = barbers.shop_id AND s.owner_id = auth.uid()
  ));
