-- CASL consent v4 — hardening from a second review (applied 2026-09-11).
-- Builds on phase58 + phase59.

-- 1) Durable SMS opt-out marker. An inbound STOP is carrier-level and blocks ALL
--    texts (reminders included); it's separate from the toggle-able reminder
--    preference and from the promo withdrawal. Set on an inbound STOP or when
--    Twilio returns 21610 on an outbound send; cleared only by an explicit START.
alter table public.clients add column if not exists sms_opted_out_at timestamptz;

-- 2) Symmetric proof: a 'withdrawn' status must carry its timestamp, like 'granted'.
alter table public.clients
  add constraint clients_promo_withdrawn_proof
  check (promo_consent_status is distinct from 'withdrawn' or promo_withdrawn_at is not null);

-- 3) Make consent_events truly APPEND-ONLY. RLS blocks anon/authenticated writes,
--    but service_role bypasses RLS and (like every role by Supabase default) holds
--    full DML — so the same key that writes the audit trail could rewrite/wipe it.
--    Triggers block UPDATE/DELETE/TRUNCATE for EVERY role; revoke the blanket write
--    grants from anon/authenticated (they only ever read via the RLS SELECT policy).
create or replace function public.consent_events_immutable() returns trigger
  language plpgsql as $$ begin raise exception 'consent_events is append-only'; end $$;
create trigger consent_events_no_update    before update   on public.consent_events for each row       execute function public.consent_events_immutable();
create trigger consent_events_no_delete    before delete   on public.consent_events for each row       execute function public.consent_events_immutable();
create trigger consent_events_no_truncate  before truncate on public.consent_events for each statement execute function public.consent_events_immutable();
revoke insert, update, delete, truncate on public.consent_events from anon, authenticated;

-- 5) Constrain the source vocabulary so the trail stays queryable (no drift).
alter table public.consent_events
  add constraint consent_events_source_chk
  check (source in ('booking_form','sms_stop','sms_start','email_unsubscribe','import'));

-- NOTE: reviewer item #4 (unique (shop_id, phone) + merging duplicates) was
-- DECLINED by the owner — phone is not enforced as client identity. Only 1 real
-- duplicate pair exists; the "6" in the report were email-only (no-phone) clients.
