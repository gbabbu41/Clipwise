-- ============================================================================
-- Phase 34: tighten the public waitlist INSERT policy.
--
-- `waitlist_insert_public` was WITH CHECK (true) — any anonymous caller could
-- insert a row for ANY shop_id (spam surface). We can't drop it: the public
-- KIOSK "Join Waitlist" page (dashboard/kiosk, no login) inserts via the anon
-- browser client. So instead we tighten the check to require the row's shop_id
-- reference a real APPROVED shop.
--
-- Safe: the kiosk + owner walk-in adds always use a real approved shop_id, so
-- they keep working; only inserts into non-existent / unapproved shops are
-- blocked. Idempotent (drop-if-exists then recreate).
-- ============================================================================

drop policy if exists "waitlist_insert_public" on public.waitlist;
create policy "waitlist_insert_public" on public.waitlist
  for insert to public
  with check (
    exists (select 1 from public.shops s where s.id = shop_id and s.status = 'approved')
  );
