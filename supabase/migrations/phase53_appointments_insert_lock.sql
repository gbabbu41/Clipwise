-- phase53 — Lock appointment INSERT to shop stakeholders (close the anon-insert door)
-- APPLIED TO PROD: 2026-08-30 (via Supabase MCP). Recorded here for the repo/other machine.
--
-- Before: `appointments_insert_public` granted INSERT with the entire check being
--   (customer_id IS NULL OR customer_id = auth.uid())
-- i.e. ANY caller holding the public/anon key (which ships in the browser bundle)
-- could insert an appointment row on ANY shop — arbitrary shop_id, barber_id (incl.
-- null), date, and total_amount. Real customer booking never uses this path: it
-- goes through service-role API routes (/api/book/in-person, /api/stripe/
-- booking-checkout, waitlist, ai-phone) which bypass RLS. The only legitimate
-- client-side inserter is a shop owner or an active barber of that shop using the
-- dashboard "Add Appointment" form.
--
-- After: INSERT requires the caller to own the shop, be an active barber of the
-- shop, or be a super-admin. Anon (auth.uid() IS NULL) fails every branch and can
-- no longer spam fake bookings onto a calendar. Mirrors the proven shape of
-- appointments_update_owner / appointments_select_stakeholder.

DROP POLICY IF EXISTS appointments_insert_public ON public.appointments;

CREATE POLICY appointments_insert_stakeholder
  ON public.appointments
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.shops s
      WHERE s.id = appointments.shop_id AND s.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.barbers b
      WHERE b.shop_id = appointments.shop_id
        AND b.user_id = auth.uid()
        AND b.is_active
    )
  );
