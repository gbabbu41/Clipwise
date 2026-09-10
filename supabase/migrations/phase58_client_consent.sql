-- CASL consent capture on clients (Canada's Anti-Spam Legislation).
--
-- Promotional email/SMS ("we miss you", "20% off", loyalty nudges) legally need
-- EXPRESS consent; transactional appointment reminders ride on the booked
-- transaction (implied consent, up to 24 months from the last visit).
--
--   promo_consent         express opt-in for promotional messages (default false)
--   sms_reminder_consent  transactional reminder texts — pre-checked at booking,
--                         so the default is true; a customer can opt out
--   consent_at            when the customer last set their consent (booking time)
--   consent_ip            IP the consent was captured from (proof of record)
--
-- `marketing_opt_out` already exists and always overrides both (a STOP /
-- unsubscribe): once true, no promotional message is ever sent.
alter table public.clients
  add column if not exists promo_consent boolean not null default false,
  add column if not exists sms_reminder_consent boolean not null default true,
  add column if not exists consent_at timestamptz,
  add column if not exists consent_ip text;
