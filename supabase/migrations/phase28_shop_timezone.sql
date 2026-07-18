-- phase28_shop_timezone.sql
-- Per-shop IANA timezone so server-side "today / is this slot in the past"
-- decisions (reschedule availability, reminder cron) are evaluated in the shop's
-- local time instead of the server's UTC. Defaults to Eastern; owners change it
-- in Settings. Safe to re-run.
alter table public.shops add column if not exists timezone text not null default 'America/Toronto';
