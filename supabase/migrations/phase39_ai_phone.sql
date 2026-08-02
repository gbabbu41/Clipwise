-- Phase 39: AI phone booking + ClipWise Business Number (add-on feature).
--
-- All additive + gated behind ai_phone_enabled — existing shops are untouched
-- (every new column defaults to off/null). Safe to run repeatedly.

-- ── Shop's business number + AI-phone state ────────────────────────────────
alter table public.shops add column if not exists twilio_phone_number  text;    -- the provisioned E.164 number
alter table public.shops add column if not exists twilio_phone_sid     text;    -- Twilio's incomingPhoneNumber SID (to release it later)
alter table public.shops add column if not exists ai_phone_enabled     boolean not null default false;  -- AI answers calls (off → missed-call SMS)
alter table public.shops add column if not exists ai_phone_plan_active boolean not null default false;  -- the $15/mo add-on is billing

-- ── Booking provenance (so a phone booking is distinguishable) ─────────────
-- Nullable → existing inserts that don't set it stay null. Values: 'phone_ai',
-- 'online', 'in_person', … (free text; the app only ever reads it).
alter table public.appointments add column if not exists source text;

-- ── Call logs (powers the Phone Activity dashboard) ────────────────────────
create table if not exists public.call_logs (
  id               uuid default gen_random_uuid() primary key,
  shop_id          uuid references public.shops(id) on delete cascade,
  caller_number    text,
  call_time        timestamptz default now(),
  outcome          text,                          -- 'booked' | 'missed' | 'abandoned'
  duration_seconds integer,
  ai_session_id    text,
  appointment_id   uuid references public.appointments(id) on delete set null,  -- set when the call booked
  created_at       timestamptz default now()
);
create index if not exists call_logs_shop_id_idx on public.call_logs (shop_id, call_time desc);

-- RLS: the shop OWNER (or super_admin) can read their own call logs. Inserts
-- happen server-side via the service-role key (bypasses RLS), so no client
-- insert policy is needed — mirrors how `transactions` is secured.
alter table public.call_logs enable row level security;
drop policy if exists "call_logs_owner_select" on public.call_logs;
create policy "call_logs_owner_select" on public.call_logs for select using (
  exists (
    select 1 from public.shops s
    where s.id = call_logs.shop_id and s.owner_id = auth.uid()
  )
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'super_admin'
  )
);
