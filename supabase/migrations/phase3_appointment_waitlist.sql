-- Smart waitlist: customers ask to be notified when a spot opens on a day
-- that's fully booked. When an appointment is later cancelled / rejected /
-- no-showed, the matching waiting customers get an email + SMS with a booking
-- link. Powers /api/waitlist/join (customer opt-in) and /api/waitlist/slot-opened
-- (fired from every cancellation site).
--
-- Run this once in the Supabase SQL Editor (paste the whole file). Idempotent.
--
-- NOTE: inserts/notify run server-side via the service-role key (supabaseAdmin),
-- which bypasses RLS — so there is deliberately NO anon insert policy here
-- (sidesteps the anon INSERT…RETURNING RLS footgun). Owners read their own
-- shop's list from the dashboard via the select policy below.

create table if not exists public.appointment_waitlist (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id)    on delete cascade,
  barber_id     uuid references public.barbers(id)           on delete set null,  -- null = any barber
  service_id    uuid references public.services(id)          on delete set null,
  client_name   text not null,
  client_email  text,
  client_phone  text,
  desired_date  date not null,
  -- "waiting" | "notified" | "converted" | "cancelled"
  status        text not null default 'waiting' check (status in ('waiting','notified','converted','cancelled')),
  notified_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists appointment_waitlist_lookup_idx
  on public.appointment_waitlist(shop_id, desired_date, status);

alter table public.appointment_waitlist enable row level security;

-- Shop owners (and super admins) can read / manage their own shop's waitlist.
drop policy if exists "appointment_waitlist_select" on public.appointment_waitlist;
create policy "appointment_waitlist_select" on public.appointment_waitlist for select using (
  exists(select 1 from public.shops s where s.id = appointment_waitlist.shop_id and s.owner_id = auth.uid())
  or public.is_super_admin()
);

drop policy if exists "appointment_waitlist_update" on public.appointment_waitlist;
create policy "appointment_waitlist_update" on public.appointment_waitlist for update using (
  exists(select 1 from public.shops s where s.id = appointment_waitlist.shop_id and s.owner_id = auth.uid())
  or public.is_super_admin()
);

drop policy if exists "appointment_waitlist_delete" on public.appointment_waitlist;
create policy "appointment_waitlist_delete" on public.appointment_waitlist for delete using (
  exists(select 1 from public.shops s where s.id = appointment_waitlist.shop_id and s.owner_id = auth.uid())
  or public.is_super_admin()
);
