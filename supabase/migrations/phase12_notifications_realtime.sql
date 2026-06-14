-- ============================================================
-- Phase 12: enable Realtime for notifications (live pop-up + chime)
-- ============================================================
-- The NotificationListener subscribes to INSERTs on public.notifications to
-- show the slide-in banner + play the chime (payments, bookings, no-shows…).
-- That only works if the table is in the `supabase_realtime` publication. It
-- was never added, so the live banner/sound never fired. Idempotent.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
