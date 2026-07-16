-- phase22_reminders_birthday.sql
-- Supports the automated-reminders cron (/api/cron/reminders):
--   • clients.birthday enables birthday messages.
-- Auto-tagging reuses the existing clients.tag column (no change needed).
-- The cron reads clients with select("*") so it degrades gracefully until this
-- runs (birthday just stays empty). Safe to run repeatedly.

alter table public.clients add column if not exists birthday date;
