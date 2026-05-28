-- ============================================================
-- ClipWise Database Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PUBLIC USERS TABLE (extends auth.users)
-- ============================================================
create table if not exists public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  name text,
  email text,
  phone text,
  role text default 'customer' check (role in ('customer', 'barber', 'shop_owner', 'super_admin')),
  avatar text,
  created_at timestamptz default now()
);

-- Auto-create public.users record on auth signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- SHOPS
-- ============================================================
create table if not exists public.shops (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  address text,
  city text,
  province text,
  postal_code text,
  phone text,
  email text,
  owner_id uuid references public.users(id) on delete cascade,
  logo text,
  description text,
  slug text unique,
  stripe_account_id text,
  instagram text,
  tiktok text,
  facebook text,
  youtube text,
  website text,
  subscription_plan text default 'pro' check (subscription_plan in ('starter','pro','premium','business')),
  is_active boolean default true,
  status text default 'pending' check (status in ('pending','approved','rejected','suspended')),
  rejection_reason text,
  created_at timestamptz default now()
);

-- ============================================================
-- BARBERS
-- ============================================================
create table if not exists public.barbers (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete set null,
  shop_id uuid references public.shops(id) on delete cascade,
  name text not null,
  email text,
  bio text,
  photo text,
  is_active boolean default true,
  commission_percent integer default 50,
  rating numeric(3,1) default 0,
  total_reviews integer default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- TIME SLOTS (barber availability per day of week)
-- day_of_week: 0=Sunday, 1=Monday, ..., 6=Saturday
-- ============================================================
create table if not exists public.time_slots (
  id uuid default gen_random_uuid() primary key,
  barber_id uuid references public.barbers(id) on delete cascade,
  day_of_week integer check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_available boolean default true,
  unique(barber_id, day_of_week)
);

-- ============================================================
-- SERVICES
-- ============================================================
create table if not exists public.services (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null,
  duration_minutes integer not null default 30,
  description text,
  category text default 'Hair',
  is_active boolean default true
);

-- ============================================================
-- APPOINTMENTS
-- ============================================================
create table if not exists public.appointments (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  barber_id uuid references public.barbers(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  customer_id uuid references public.users(id) on delete set null,
  -- Stored directly for walk-in / unauthenticated bookings
  client_name text,
  client_email text,
  client_phone text,
  date date not null,
  time_slot text not null,  -- stored as "9:00 AM" display format
  status text default 'pending' check (status in ('pending','confirmed','completed','cancelled','no-show')),
  notes text,
  deposit_paid boolean default false,
  total_amount numeric(10,2),
  payment_method text check (payment_method in ('card','cash','online')),
  created_at timestamptz default now()
);

-- ============================================================
-- CLIENTS (shop's CRM records, separate from auth users)
-- ============================================================
create table if not exists public.clients (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  notes text,
  total_visits integer default 0,
  total_spent numeric(10,2) default 0,
  last_visit date,
  preferred_barber_id uuid references public.barbers(id) on delete set null,
  loyalty_points integer default 0,
  tag text default 'New' check (tag in ('New','Returning','VIP','At Risk'))
);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  barber_id uuid references public.barbers(id) on delete set null,
  client_name text,
  service_name text,
  amount numeric(10,2) not null,
  tip numeric(10,2) default 0,
  commission_amount numeric(10,2),
  payment_method text check (payment_method in ('card','cash','online')),
  type text default 'service' check (type in ('service','product','tip')),
  created_at timestamptz default now()
);

-- ============================================================
-- INVENTORY
-- ============================================================
create table if not exists public.inventory (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  name text not null,
  category text,
  price numeric(10,2),
  cost_price numeric(10,2),
  quantity integer default 0,
  low_stock_threshold integer default 5
);

-- ============================================================
-- STAFF HOURS
-- ============================================================
create table if not exists public.staff_hours (
  id uuid default gen_random_uuid() primary key,
  barber_id uuid references public.barbers(id) on delete cascade,
  shop_id uuid references public.shops(id) on delete cascade,
  clock_in timestamptz,
  clock_out timestamptz,
  date date,
  hours_worked numeric(5,2)
);

-- ============================================================
-- LOYALTY REWARDS
-- ============================================================
create table if not exists public.loyalty_rewards (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  points integer,
  action text,
  created_at timestamptz default now()
);

-- ============================================================
-- WAITLIST
-- ============================================================
create table if not exists public.waitlist (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  barber_id uuid references public.barbers(id) on delete set null,
  client_name text,
  client_phone text,
  service_id uuid references public.services(id) on delete set null,
  added_at timestamptz default now(),
  status text default 'waiting' check (status in ('waiting','called','served','removed'))
);

-- ============================================================
-- PROMO CODES
-- ============================================================
create table if not exists public.promo_codes (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  code text not null,
  discount_type text check (discount_type in ('percent','fixed')),
  discount_value numeric(10,2),
  uses_left integer,
  total_uses integer default 0,
  expires_at date,
  is_active boolean default true
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
create table if not exists public.notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade,
  title text,
  message text,
  type text check (type in ('booking','cancellation','no-show','review','inventory','system')),
  is_read boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- REVIEWS
-- ============================================================
create table if not exists public.reviews (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  barber_id uuid references public.barbers(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  client_name text,
  rating integer check (rating between 1 and 5),
  comment text,
  reply text,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.users enable row level security;
alter table public.shops enable row level security;
alter table public.barbers enable row level security;
alter table public.time_slots enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.clients enable row level security;
alter table public.transactions enable row level security;
alter table public.inventory enable row level security;
alter table public.staff_hours enable row level security;
alter table public.loyalty_rewards enable row level security;
alter table public.waitlist enable row level security;
alter table public.promo_codes enable row level security;
alter table public.notifications enable row level security;
alter table public.reviews enable row level security;

-- Helper functions
create or replace function public.is_super_admin()
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.users where id = auth.uid() and role = 'super_admin');
$$;

create or replace function public.owns_shop(shop_uuid uuid)
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.shops where id = shop_uuid and owner_id = auth.uid());
$$;

create or replace function public.user_shop_id()
returns uuid language sql security definer stable as $$
  select id from public.shops where owner_id = auth.uid() limit 1;
$$;

-- ============================================================
-- SECURITY TRIGGERS
-- ============================================================

-- Prevent role escalation: customer→owner/barber is allowed at signup,
-- but no one can self-assign super_admin, and a set role cannot be
-- changed except by an existing super_admin.
create or replace function public.prevent_role_escalation()
returns trigger language plpgsql security definer as $$
begin
  if old.role is distinct from new.role then
    if new.role = 'super_admin' and not public.is_super_admin() then
      raise exception 'Permission denied: cannot escalate to super_admin';
    end if;
    if old.role <> 'customer' and not public.is_super_admin() then
      raise exception 'Permission denied: role can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists check_user_role_change on public.users;
create trigger check_user_role_change
  before update on public.users
  for each row execute function public.prevent_role_escalation();

-- Prevent shop owners from self-approving or upgrading their own plan.
create or replace function public.prevent_shop_field_escalation()
returns trigger language plpgsql security definer as $$
begin
  if not public.is_super_admin() then
    if old.status is distinct from new.status then
      raise exception 'Permission denied: shop status can only be changed by an administrator';
    end if;
    if old.subscription_plan is distinct from new.subscription_plan then
      raise exception 'Permission denied: subscription plan can only be changed by an administrator';
    end if;
    if old.owner_id is distinct from new.owner_id then
      raise exception 'Permission denied: cannot transfer shop ownership';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists check_shop_fields on public.shops;
create trigger check_shop_fields
  before update on public.shops
  for each row execute function public.prevent_shop_field_escalation();

-- Prevent barbers from updating their own sensitive operational fields.
-- They may update name, email, bio, photo only.
create or replace function public.restrict_barber_self_update()
returns trigger language plpgsql security definer as $$
begin
  if auth.uid() = old.user_id
     and not public.is_super_admin()
     and not exists(select 1 from public.shops where id = old.shop_id and owner_id = auth.uid())
  then
    if old.is_active is distinct from new.is_active then
      raise exception 'Permission denied: is_active can only be changed by the shop owner';
    end if;
    if old.commission_percent is distinct from new.commission_percent then
      raise exception 'Permission denied: commission can only be changed by the shop owner';
    end if;
    if old.rating is distinct from new.rating then
      raise exception 'Permission denied: rating cannot be manually changed';
    end if;
    if old.total_reviews is distinct from new.total_reviews then
      raise exception 'Permission denied: total_reviews cannot be manually changed';
    end if;
    if old.shop_id is distinct from new.shop_id then
      raise exception 'Permission denied: cannot change shop assignment';
    end if;
    if old.user_id is distinct from new.user_id then
      raise exception 'Permission denied: cannot transfer barber account';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists check_barber_self_update on public.barbers;
create trigger check_barber_self_update
  before update on public.barbers
  for each row execute function public.restrict_barber_self_update();

-- ============================================================
-- USERS policies
-- ============================================================
create policy "users_select_own" on public.users for select using (auth.uid() = id or public.is_super_admin());
create policy "users_insert_own" on public.users for insert with check (auth.uid() = id);
create policy "users_update_own" on public.users for update using (auth.uid() = id or public.is_super_admin());
-- Note: prevent_role_escalation trigger enforces column-level security on role.

-- ============================================================
-- SHOPS policies
-- ============================================================
create policy "shops_select_public" on public.shops for select using (status = 'approved' or owner_id = auth.uid() or public.is_super_admin());
create policy "shops_insert_owner" on public.shops for insert with check (auth.uid() = owner_id);
create policy "shops_update_owner" on public.shops for update using (owner_id = auth.uid() or public.is_super_admin());
create policy "shops_delete_admin" on public.shops for delete using (public.is_super_admin());
-- Note: prevent_shop_field_escalation trigger blocks status/plan/owner_id changes by non-admins.

-- ============================================================
-- BARBERS policies
-- ============================================================

-- Barbers at approved shops are public. Shop owners see all their barbers.
-- Barbers can always see their own record (even while shop is pending).
create policy "barbers_select_public" on public.barbers for select using (
  exists(select 1 from public.shops s where s.id = barbers.shop_id and s.status = 'approved')
  or exists(select 1 from public.shops s where s.id = barbers.shop_id and s.owner_id = auth.uid())
  or user_id = auth.uid()
  or public.is_super_admin()
);

-- Shop owners add barbers directly (no user_id required — owner-managed barbers)
create policy "barbers_insert_owner" on public.barbers for insert with check (
  exists(select 1 from public.shops where id = barbers.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- Barbers self-register by claiming their own user_id at an approved shop
create policy "barbers_self_register" on public.barbers for insert with check (
  user_id = auth.uid()
  and exists(select 1 from public.shops where id = barbers.shop_id and status = 'approved')
);

-- Shop owners can update any field. Barbers can update their own profile fields only
-- (restrict_barber_self_update trigger enforces the column-level restriction).
create policy "barbers_update_owner" on public.barbers for update using (
  exists(select 1 from public.shops where id = barbers.shop_id and owner_id = auth.uid())
  or user_id = auth.uid()
  or public.is_super_admin()
);

create policy "barbers_delete_owner" on public.barbers for delete using (
  exists(select 1 from public.shops where id = barbers.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- ============================================================
-- TIME SLOTS policies
-- ============================================================
create policy "time_slots_select_all" on public.time_slots for select using (true);
create policy "time_slots_manage_owner" on public.time_slots for all using (
  exists(
    select 1 from public.barbers b join public.shops s on b.shop_id = s.id
    where b.id = time_slots.barber_id and (s.owner_id = auth.uid() or b.user_id = auth.uid())
  ) or public.is_super_admin()
);

-- ============================================================
-- SERVICES policies
-- ============================================================
create policy "services_select_public" on public.services for select using (true);
create policy "services_manage_owner" on public.services for all using (
  exists(select 1 from public.shops where id = services.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- ============================================================
-- APPOINTMENTS policies
-- ============================================================

-- customer_id must be the caller's own ID or null (walk-in/unauthenticated).
-- Prevents injecting fake appointments into another user's history.
create policy "appointments_insert_public" on public.appointments for insert with check (
  customer_id is null or customer_id = auth.uid()
);
create policy "appointments_select_stakeholder" on public.appointments for select using (
  exists(select 1 from public.shops where id = appointments.shop_id and owner_id = auth.uid())
  or customer_id = auth.uid()
  or exists(select 1 from public.barbers where id = appointments.barber_id and user_id = auth.uid())
  or public.is_super_admin()
);
create policy "appointments_update_owner" on public.appointments for update using (
  exists(select 1 from public.shops where id = appointments.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- ============================================================
-- CLIENTS policies
-- ============================================================
create policy "clients_manage_owner" on public.clients for all using (
  exists(select 1 from public.shops where id = clients.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- ============================================================
-- TRANSACTIONS policies
-- ============================================================
create policy "transactions_manage_owner" on public.transactions for all using (
  exists(select 1 from public.shops where id = transactions.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- ============================================================
-- INVENTORY policies
-- ============================================================
create policy "inventory_manage_owner" on public.inventory for all using (
  exists(select 1 from public.shops where id = inventory.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- ============================================================
-- STAFF HOURS policies
-- ============================================================

-- Shop owner has full access (read, insert, update, delete).
create policy "staff_hours_owner_all" on public.staff_hours for all using (
  exists(select 1 from public.shops where id = staff_hours.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- Barbers can clock in (insert) and view their own records only.
-- No update/delete: prevents fabricating hours worked.
create policy "staff_hours_barber_insert" on public.staff_hours for insert with check (
  exists(select 1 from public.barbers where id = staff_hours.barber_id and user_id = auth.uid())
);
create policy "staff_hours_barber_select" on public.staff_hours for select using (
  exists(select 1 from public.barbers where id = staff_hours.barber_id and user_id = auth.uid())
);

-- ============================================================
-- PROMO CODES policies
-- ============================================================
create policy "promo_codes_select_active" on public.promo_codes for select using (is_active = true or exists(select 1 from public.shops where id = promo_codes.shop_id and owner_id = auth.uid()) or public.is_super_admin());
create policy "promo_codes_manage_owner" on public.promo_codes for all using (
  exists(select 1 from public.shops where id = promo_codes.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- ============================================================
-- NOTIFICATIONS policies
-- ============================================================
create policy "notifications_own" on public.notifications for all using (user_id = auth.uid() or public.is_super_admin());

-- ============================================================
-- REVIEWS policies
-- ============================================================
create policy "reviews_select_public" on public.reviews for select using (true);
create policy "reviews_manage_owner" on public.reviews for all using (
  exists(select 1 from public.shops where id = reviews.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- ============================================================
-- WAITLIST policies
-- ============================================================
create policy "waitlist_insert_public" on public.waitlist for insert with check (true);
create policy "waitlist_manage_owner" on public.waitlist for all using (
  exists(select 1 from public.shops where id = waitlist.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- ============================================================
-- LOYALTY REWARDS policies
-- ============================================================
create policy "loyalty_manage_owner" on public.loyalty_rewards for all using (
  exists(select 1 from public.shops where id = loyalty_rewards.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);


-- ============================================================
-- MESSAGES TABLE (client messaging feature)
-- Added: 2026-05-27
-- ============================================================
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null,
  client_phone text,
  sender text not null check (sender in ('shop', 'client')),
  content text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists messages_shop_client_idx
  on public.messages (shop_id, client_name, created_at);

-- RLS
alter table public.messages enable row level security;

create policy "messages_shop_owner" on public.messages for all using (
  exists(select 1 from public.shops where id = messages.shop_id and owner_id = auth.uid())
  or exists(select 1 from public.barbers where shop_id = messages.shop_id and user_id = auth.uid())
  or public.is_super_admin()
);
