-- Time-off requests: barbers submit, owners approve/deny.
-- Used by /barber-dashboard/time-off and /dashboard/time-off.
--
-- Run this once in the Supabase SQL Editor (paste the whole file).
-- It's idempotent — safe to re-run.

create table if not exists public.time_off_requests (
  id          uuid primary key default gen_random_uuid(),
  barber_id   uuid not null references public.barbers(id) on delete cascade,
  shop_id     uuid not null references public.shops(id)   on delete cascade,
  -- "day_off" | "vacation" | "blocked_hours" | "sick"
  type        text not null check (type in ('day_off','vacation','blocked_hours','sick')),
  start_date  date not null,
  end_date    date not null,
  -- Only used when type = 'blocked_hours' (e.g. 14:00 → 15:00 on one day)
  start_time  time,
  end_time    time,
  reason      text,
  -- "pending" | "approved" | "denied"
  status      text not null default 'pending' check (status in ('pending','approved','denied')),
  decided_by  uuid references public.users(id),
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists time_off_requests_shop_idx     on public.time_off_requests(shop_id, status);
create index if not exists time_off_requests_barber_idx   on public.time_off_requests(barber_id, start_date desc);

alter table public.time_off_requests enable row level security;

-- Barbers see their own requests; shop owners see everything in their shop.
drop policy if exists "time_off_requests_select" on public.time_off_requests;
create policy "time_off_requests_select" on public.time_off_requests for select using (
  exists(select 1 from public.barbers b where b.id = time_off_requests.barber_id and b.user_id = auth.uid())
  or exists(select 1 from public.shops s where s.id = time_off_requests.shop_id and s.owner_id = auth.uid())
  or public.is_super_admin()
);

-- Barbers can submit a request for themselves only.
drop policy if exists "time_off_requests_insert" on public.time_off_requests;
create policy "time_off_requests_insert" on public.time_off_requests for insert with check (
  exists(select 1 from public.barbers b where b.id = time_off_requests.barber_id and b.user_id = auth.uid())
);

-- Shop owners approve / deny; barbers can update their own (e.g. cancel = delete below).
drop policy if exists "time_off_requests_update" on public.time_off_requests;
create policy "time_off_requests_update" on public.time_off_requests for update using (
  exists(select 1 from public.shops s where s.id = time_off_requests.shop_id and s.owner_id = auth.uid())
  or public.is_super_admin()
);

-- Barbers can cancel their own pending requests; shop owners can delete any.
drop policy if exists "time_off_requests_delete" on public.time_off_requests;
create policy "time_off_requests_delete" on public.time_off_requests for delete using (
  (
    exists(select 1 from public.barbers b where b.id = time_off_requests.barber_id and b.user_id = auth.uid())
    and status = 'pending'
  )
  or exists(select 1 from public.shops s where s.id = time_off_requests.shop_id and s.owner_id = auth.uid())
  or public.is_super_admin()
);

-- Realtime — so owner sees new requests and barber sees approve/deny live.
alter publication supabase_realtime add table public.time_off_requests;
