-- phase18: recurring breaks/lunch per barber per weekday (the visual Schedule
-- page). Working hours stay in time_slots; one-off blocks stay in
-- time_off_requests. These recurring breaks are subtracted from bookable slots.
-- Accessed only via service-role routes (/api/schedule, /api/availability), so
-- RLS is enabled with no client policies (service role bypasses RLS).
create table if not exists public.barber_breaks (
  id uuid default gen_random_uuid() primary key,
  barber_id uuid references public.barbers(id) on delete cascade,
  shop_id uuid references public.shops(id) on delete cascade,
  day_of_week integer check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  label text,
  created_at timestamptz default now()
);
create index if not exists idx_barber_breaks_barber on public.barber_breaks(barber_id);
create index if not exists idx_barber_breaks_lookup on public.barber_breaks(barber_id, day_of_week);
alter table public.barber_breaks enable row level security;
