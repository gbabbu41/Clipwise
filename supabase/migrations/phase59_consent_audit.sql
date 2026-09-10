-- CASL consent v3 — hardening on top of phase58 (which must be applied first).
--
-- 1) Reminder flag is a PREFERENCE, not a consent. It defaults true (reminders
--    ride on the booked transaction / existing business relationship), so calling
--    it "consent" asserts something nobody agreed to. Rename it honestly.
alter table public.clients rename column sms_reminder_consent    to sms_reminder_opt_in;
alter table public.clients rename column sms_reminder_consent_at to sms_reminder_opt_in_at;

-- 2) Store the consent IP as a real inet (validation + containment operators).
--    Every value is null today, so the cast is a no-op.
alter table public.clients
  alter column promo_consent_ip type inet using nullif(promo_consent_ip, '')::inet;

-- 3) Express consent must carry proof of WHEN it was given — you can't have a
--    'granted' row without a timestamp.
alter table public.clients
  add constraint clients_promo_consent_proof
  check (promo_consent_status is distinct from 'granted' or promo_consent_at is not null);

-- 4) CASL consent is granted to a SPECIFIC sender — a client with no shop belongs
--    to nobody. Verified 0 null rows before setting this.
alter table public.clients alter column shop_id set not null;

-- 5) Append-only audit trail — the record that survives a CRTC inquiry. Row
--    columns are the fast "can I send now?" cache; this log is the permanent
--    proof of every grant/withdrawal, with source + IP + when.
create table if not exists public.consent_events (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references public.clients(id) on delete cascade,
  shop_id    uuid not null references public.shops(id)   on delete cascade,
  kind       text not null check (kind in ('reminder', 'promo')),
  granted    boolean not null,
  source     text not null,   -- 'booking_form' | 'sms_stop' | 'sms_start' | 'email_unsubscribe' | 'import'
  ip         inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists consent_events_client_idx
  on public.consent_events (client_id, created_at desc);

-- RLS: only the server (service role) writes; the shop owner may READ their own
-- events (for proof/display). No INSERT/UPDATE/DELETE policy = writes are
-- service-role only, which keeps the trail append-only from the app's side.
alter table public.consent_events enable row level security;
create policy consent_events_owner_read on public.consent_events for select
  using (
    exists (select 1 from public.shops s where s.id = consent_events.shop_id and s.owner_id = auth.uid())
    or is_super_admin()
  );
