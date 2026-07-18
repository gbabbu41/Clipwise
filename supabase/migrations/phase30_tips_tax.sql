-- phase30_tips_tax.sql
-- Record tips + sales tax as their own amounts (config lives in
-- shops.booking_settings JSON; these are the recorded money columns).
--   • transactions.tax        — tax portion of a POS / online sale
--   • appointments.tip_amount — tip collected on an online booking / tip link
--   • appointments.tax_amount — tax portion of an online booking
-- transactions.tip already exists. All default 0 so existing rows are unaffected.
-- Safe to re-run.
alter table public.transactions add column if not exists tax numeric not null default 0;
alter table public.appointments add column if not exists tip_amount numeric not null default 0;
alter table public.appointments add column if not exists tax_amount numeric not null default 0;
