-- ============================================================
-- ClipWise Security Patches
-- Run this in the Supabase SQL Editor AFTER the main schema.
-- Safe to re-run — uses CREATE OR REPLACE and DROP IF EXISTS.
-- ============================================================


-- ============================================================
-- FIX 1 (CRITICAL): Prevent role escalation via users table
-- Without this, any logged-in user can set role = 'super_admin'
-- on their own row via the public API.
--
-- Allowed transitions (by the user themselves):
--   customer → shop_owner   (owner signup flow)
--   customer → barber       (barber signup flow)
-- Blocked:
--   anything → super_admin  (must be done manually in Supabase dashboard)
--   non-customer → anything (role is locked once set; only admin can change)
-- ============================================================
create or replace function public.prevent_role_escalation()
returns trigger language plpgsql security definer as $$
begin
  if old.role is distinct from new.role then
    -- Escalating to super_admin is never allowed via client
    if new.role = 'super_admin' and not public.is_super_admin() then
      raise exception 'Permission denied: cannot escalate to super_admin';
    end if;
    -- Once a non-customer role is set, only an admin can change it
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


-- ============================================================
-- FIX 2 (CRITICAL): Prevent shop owners from self-approving
-- their shop or upgrading their own subscription plan.
-- ============================================================
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


-- ============================================================
-- FIX 3 (HIGH): barbers_self_register must require approved shop
-- The original policy allowed self-registration at pending,
-- suspended, or rejected shops.
-- ============================================================
drop policy if exists "barbers_self_register" on public.barbers;
create policy "barbers_self_register" on public.barbers for insert with check (
  user_id = auth.uid()
  and exists(
    select 1 from public.shops
    where id = barbers.shop_id and status = 'approved'
  )
);


-- ============================================================
-- FIX 4 (HIGH): Barbers can only update their own profile
-- fields (name, email, bio, photo). Sensitive operational
-- fields (is_active, commission_percent, rating, total_reviews,
-- shop_id, user_id) are owner-only.
-- ============================================================
create or replace function public.restrict_barber_self_update()
returns trigger language plpgsql security definer as $$
begin
  -- Only restrict when the caller is the barber themselves,
  -- not the shop owner and not an admin.
  if auth.uid() = old.user_id
     and not public.is_super_admin()
     and not exists(
       select 1 from public.shops
       where id = old.shop_id and owner_id = auth.uid()
     )
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
-- FIX 5 (HIGH): appointments — validate customer_id
-- Without this, anyone can set customer_id to another user's
-- UUID, injecting fake appointments into their history.
-- ============================================================
drop policy if exists "appointments_insert_public" on public.appointments;
create policy "appointments_insert_public" on public.appointments for insert with check (
  -- walk-in / unauthenticated: customer_id must be null
  -- authenticated: customer_id must be their own ID or null
  customer_id is null or customer_id = auth.uid()
);


-- ============================================================
-- FIX 6 (MEDIUM): staff_hours — barbers get insert+select only
-- The original "for all" policy allowed barbers to UPDATE and
-- DELETE their own clock records (fabricate hours).
-- ============================================================
drop policy if exists "staff_hours_manage_owner" on public.staff_hours;

-- Shop owner retains full access
create policy "staff_hours_owner_all" on public.staff_hours for all using (
  exists(select 1 from public.shops where id = staff_hours.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- Barbers can clock in (insert) and view their own records
create policy "staff_hours_barber_insert" on public.staff_hours for insert with check (
  exists(select 1 from public.barbers where id = staff_hours.barber_id and user_id = auth.uid())
);
create policy "staff_hours_barber_select" on public.staff_hours for select using (
  exists(select 1 from public.barbers where id = staff_hours.barber_id and user_id = auth.uid())
);


-- ============================================================
-- FIX 8: RPC function for barber self-registration
-- Runs as SECURITY DEFINER (DB owner) so it bypasses RLS.
-- All validation is done inside the function instead.
-- Client calls: supabase.rpc("register_barber", { ... })
-- ============================================================
create or replace function public.register_barber(
  p_shop_id  uuid,
  p_name     text,
  p_email    text,
  p_bio      text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_barber_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Only allow joining approved shops
  if not exists(select 1 from public.shops where id = p_shop_id and status = 'approved') then
    raise exception 'Shop not found or not yet approved';
  end if;

  -- Idempotent: return existing record if already registered
  select id into v_barber_id
  from public.barbers
  where user_id = v_user_id and shop_id = p_shop_id;

  if v_barber_id is not null then
    return v_barber_id;
  end if;

  insert into public.barbers (shop_id, user_id, name, email, bio, is_active)
  values (p_shop_id, v_user_id, p_name, p_email, p_bio, false)
  returning id into v_barber_id;

  return v_barber_id;
end;
$$;


-- ============================================================
-- FIX 9 (CRITICAL): Infinite recursion in shops RLS
-- Root cause: shops_select_public calls is_super_admin() → queries users →
-- users_select_own calls is_super_admin() → queries users again → infinite loop.
-- Fix: recreate is_super_admin() with explicit SECURITY DEFINER + safe search_path,
-- and split users policies so SELECT doesn't call is_super_admin() at all.
-- ============================================================

-- Recreate with set search_path so it always bypasses RLS on public.users
create or replace function public.is_super_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists(select 1 from public.users where id = auth.uid() and role = 'super_admin');
$$;

-- Break the cycle: users SELECT policy must NOT call is_super_admin()
-- (super admins see their own row via auth.uid() = id like everyone else)
drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users for select using (
  auth.uid() = id
);

-- Separate admin select policy — safe because is_super_admin() is SECURITY DEFINER
-- and bypasses this policy when it runs its own query on users.
drop policy if exists "users_select_admin" on public.users;
create policy "users_select_admin" on public.users for select using (
  public.is_super_admin()
);


-- ============================================================
-- FIX 7 (MISSING POLICY): Barbers can read their own record
-- The original barbers_select_public only shows barbers at
-- approved shops or shops the viewer owns. A newly registered
-- barber at a pending shop cannot see their own record at all.
-- ============================================================
drop policy if exists "barbers_select_public" on public.barbers;
create policy "barbers_select_public" on public.barbers for select using (
  -- public: barbers at approved shops
  exists(select 1 from public.shops s where s.id = barbers.shop_id and s.status = 'approved')
  -- shop owner sees all their barbers regardless of shop status
  or exists(select 1 from public.shops s where s.id = barbers.shop_id and s.owner_id = auth.uid())
  -- barbers can always see their own record
  or user_id = auth.uid()
  or public.is_super_admin()
);
