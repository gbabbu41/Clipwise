-- CASL consent on clients (Canada's Anti-Spam Legislation) — ONE source of truth.
--
-- Promotional messages ("we miss you", "20% off", loyalty nudges) legally need
-- EXPRESS opt-in; transactional appointment reminders ride on the booked
-- transaction (implied consent, up to 24 months from the last visit).
--
-- Promotional consent is a TRI-STATE, because "never asked" and "explicitly
-- opted out" are legally different:
--   promo_consent_status = 'granted'   → express opt-in (they ticked the box)
--   promo_consent_status = 'withdrawn' → STOP / unsubscribe: a permanent hard
--                                        block, overrides even implied consent
--   promo_consent_status IS NULL       → never asked (no express consent, but an
--                                        existing business relationship within 24
--                                        months is implied consent under CASL)
-- Each promotional consent has its OWN proof (when + IP + where it was granted,
-- and separately when it was withdrawn) — a single shared timestamp can't prove
-- which consent it refers to, and CASL puts the burden of proof on the sender.
--
-- Transactional reminders are a separate preference with its own timestamp.
--
-- This REPLACES the old boolean `marketing_opt_out` (an opt-OUT default, which is
-- the CASL-wrong polarity) — it was all-false/unused, so it's dropped to avoid a
-- second, inverted source of truth that would drift.

alter table public.clients
  add column if not exists promo_consent_status  text
    check (promo_consent_status in ('granted', 'withdrawn')),
  add column if not exists promo_consent_at       timestamptz,  -- when 'granted' (proof)
  add column if not exists promo_consent_ip       text,         -- IP at grant (proof)
  add column if not exists promo_consent_source   text,         -- where the grant came from
  add column if not exists promo_withdrawn_at      timestamptz,  -- when 'withdrawn' (STOP/unsub)
  add column if not exists sms_reminder_consent    boolean not null default true,
  add column if not exists sms_reminder_consent_at timestamptz;

-- Retire the old opt-out flag (was all-false / unused). Run AFTER the new code is
-- deployed so nothing reads it mid-migration.
alter table public.clients drop column if exists marketing_opt_out;
