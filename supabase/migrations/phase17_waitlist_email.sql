-- phase17_waitlist_email.sql
-- Walk-in queue can now capture a customer email (kiosk + manual add), so we can
-- email them — not just text — when they're called. Safe to run multiple times.
alter table public.waitlist
  add column if not exists client_email text;
