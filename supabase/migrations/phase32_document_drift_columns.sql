-- ============================================================================
-- Phase 32: document the "drift" columns — ones the CODE has always written to
-- but that were never defined in schema.sql or any migration (they only existed
-- on prod because they were hand-added out-of-band). This makes the repo match
-- reality, so a fresh clone / new environment gets them too.
--
-- Safe to run (idempotent) — every column uses ADD COLUMN IF NOT EXISTS, so on
-- prod (where these already exist) it's a no-op.
--
-- The two on `appointments` are the most important: the entire payment +
-- Stripe-webhook path writes them, and phase1_no_show.sql wrongly assumed they
-- already existed, so no file ever created them.
-- ============================================================================

-- shops — subscription + Stripe Connect state, notification templates, Google place id
alter table public.shops add column if not exists subscription_status    text default 'inactive';
alter table public.shops add column if not exists stripe_subscription_id  text;
alter table public.shops add column if not exists stripe_customer_id      text;
alter table public.shops add column if not exists stripe_connected        boolean default false;
alter table public.shops add column if not exists stripe_connect_status   text;
alter table public.shops add column if not exists notification_templates  jsonb;
alter table public.shops add column if not exists google_place_id         text;

-- appointments — payment state the checkout / webhook path writes (MOST critical)
alter table public.appointments add column if not exists payment_status    text default 'unpaid';
alter table public.appointments add column if not exists payment_intent_id text;

-- barbers — per-barber permissions (staff page "manage" toggles)
alter table public.barbers add column if not exists permissions jsonb;

-- services — legacy deposit fields (still written on every service save/insert)
alter table public.services add column if not exists deposit_required boolean default false;
alter table public.services add column if not exists deposit_amount   numeric default 0;
