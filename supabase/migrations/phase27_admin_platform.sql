-- phase27_admin_platform.sql
-- Backing tables for the admin "CEO control center":
--   1) platform_settings — single-row JSONB config (platform name, support email
--      + global kill-switches: signups_enabled, maintenance_mode, auto_approve_shops)
--   2) admin_audit_log    — append-only record of every super-admin action
--   3) shop_admin_meta     — private per-shop internal note (super-admin only)
-- All admin writes go through service-role API routes; RLS here is defence-in-depth
-- (super-admins may read; nobody else can see any of it). Safe to run repeatedly.

-- ── 1. Platform settings (single row, id = 1) ──────────────────────────────
create table if not exists public.platform_settings (
  id smallint primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint platform_settings_singleton check (id = 1)
);
insert into public.platform_settings (id, data) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
drop policy if exists "platform_settings_admin_read" on public.platform_settings;
create policy "platform_settings_admin_read" on public.platform_settings
  for select using (public.is_super_admin());
-- Writes only via the service role (bypasses RLS) — no write policy on purpose.

-- ── 2. Admin audit log ─────────────────────────────────────────────────────
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,                 -- shop.approve, shop.suspend, plan.update, settings.update…
  target_type text,                     -- shop | plan | settings | user
  target_id text,
  target_label text,                    -- human label (shop name, plan name…)
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx  on public.admin_audit_log (target_type, target_id);

alter table public.admin_audit_log enable row level security;
drop policy if exists "admin_audit_log_admin_read" on public.admin_audit_log;
create policy "admin_audit_log_admin_read" on public.admin_audit_log
  for select using (public.is_super_admin());
-- Inserts only via the service role.

-- ── 3. Private admin note per shop ─────────────────────────────────────────
-- A separate table (not a shops column) so the note never leaks to the shop
-- owner through their normal shop SELECT policy.
create table if not exists public.shop_admin_meta (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.shop_admin_meta enable row level security;
drop policy if exists "shop_admin_meta_admin" on public.shop_admin_meta;
create policy "shop_admin_meta_admin" on public.shop_admin_meta for all
  using (public.is_super_admin()) with check (public.is_super_admin());
