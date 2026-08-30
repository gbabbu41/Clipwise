-- phase54 — RLS privilege lockdown (CRITICAL security fixes)
-- STATUS: APPLIED to prod 2026-08-30 via MCP, and verified (a simulated non-admin
-- self-elevation is rejected by RLS). Recorded here for the repo / other machine.

-- 1) Block super_admin self-elevation. `users` has three permissive UPDATE-applicable
-- policies (barbers_no_users_access ALL, protect_admin_role, users_update_own); two
-- approve any change to your own row (null WITH CHECK → USING = own row), so they
-- OR-bypass protect_admin_role's role<>'super_admin'. Any signed-in user could set
-- role='super_admin' on themselves (is_super_admin() gates 20+ policies → full takeover).
-- A RESTRICTIVE policy is AND-ed with every permissive UPDATE and can't be OR-bypassed.
DROP POLICY IF EXISTS users_no_self_elevate ON public.users;
CREATE POLICY users_no_self_elevate ON public.users
  AS RESTRICTIVE FOR UPDATE
  USING (true)
  WITH CHECK (role IS DISTINCT FROM 'super_admin' OR is_super_admin());

-- 2) Kill uninvited barber self-registration. barbers_self_register let ANY authenticated
-- user INSERT an active barber row at any approved shop → inherit that shop's staff RLS
-- (clients' PII, transactions, messages, schedules, appointment writes). Legit onboarding
-- uses register_barber() (SECURITY DEFINER, is_active=false) + accept-invite (service role),
-- both of which bypass RLS; barbers_insert_owner (owner adds staff to own shop) already
-- exists. So the self-register policy is pure hole — drop it.
DROP POLICY IF EXISTS barbers_self_register ON public.barbers;

-- 3) Stop a barber escalating their OWN row. barbers_update_owner has no WITH CHECK, so a
-- barber (user_id = auth.uid()) could set commission_percent=100, is_active=true, or move
-- shop_id. RLS can't compare OLD/NEW, so a BEFORE UPDATE trigger freezes the sensitive
-- columns for a self-editing barber (they keep name/email/bio/photo/bookings_paused). Shop
-- owner and the service role (auth.uid() IS NULL) are exempt.
CREATE OR REPLACE FUNCTION public.barbers_guard_self_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;                 -- service role / server routes
  IF is_super_admin()
     OR EXISTS (SELECT 1 FROM public.shops s WHERE s.id = OLD.shop_id AND s.owner_id = auth.uid())
  THEN RETURN NEW; END IF;                                       -- shop owner / admin
  NEW.commission_percent := OLD.commission_percent;
  NEW.is_active          := OLD.is_active;
  NEW.shop_id            := OLD.shop_id;
  NEW.user_id            := OLD.user_id;
  NEW.permissions        := OLD.permissions;
  NEW.rating             := OLD.rating;
  NEW.total_reviews      := OLD.total_reviews;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS barbers_guard_self_update ON public.barbers;
CREATE TRIGGER barbers_guard_self_update BEFORE UPDATE ON public.barbers
  FOR EACH ROW EXECUTE FUNCTION public.barbers_guard_self_update();
