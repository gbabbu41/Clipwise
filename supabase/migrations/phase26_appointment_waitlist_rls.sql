-- phase26_appointment_waitlist_rls.sql
-- The Spot Waitlist owner page (dashboard/waitlist-requests) reads + updates
-- public.appointment_waitlist through the anon browser client, but the table
-- had RLS enabled with NO policy — so the owner saw an empty list and "Remove"
-- silently failed. Customer sign-ups go through service-role API routes (which
-- bypass RLS), so only an owner-manage policy is needed. Safe to run repeatedly.

drop policy if exists "appt_waitlist_owner_manage" on public.appointment_waitlist;
create policy "appt_waitlist_owner_manage" on public.appointment_waitlist for all using (
  exists(select 1 from public.shops where id = appointment_waitlist.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
) with check (
  exists(select 1 from public.shops where id = appointment_waitlist.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);
