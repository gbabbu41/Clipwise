-- phase47_plan_coupons.sql
-- Admin "comp" coupons: grant free Pro/Premium days (bypass payment) by extending
-- a shop's no-card trial window. Two use paths, one engine:
--   • admin applies days directly to a shop (one-tap, no code), and
--   • admin generates a code the customer redeems in Billing.
--
-- Managed entirely server-side via super-admin-gated API routes + the service
-- role, so RLS is enabled with NO policies (locks out anon/authenticated direct
-- access; the service role bypasses RLS). Safe/idempotent.

create table if not exists public.plan_coupons (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  plan        text not null default 'pro',       -- pro | premium | business
  days        integer not null default 10,       -- free days granted per redemption
  max_uses    integer not null default 1,        -- how many shops can redeem it
  used_count  integer not null default 0,
  expires_at  timestamptz,                        -- optional: code stops working after this
  is_active   boolean not null default true,
  note        text,                               -- admin memo (who/why)
  created_at  timestamptz not null default now(),
  constraint plan_coupons_code_len check (char_length(code) <= 40),
  constraint plan_coupons_days_ck  check (days > 0 and days <= 365),
  constraint plan_coupons_note_len check (note is null or char_length(note) <= 200)
);

create table if not exists public.plan_coupon_redemptions (
  id           uuid primary key default gen_random_uuid(),
  coupon_id    uuid references public.plan_coupons(id) on delete cascade,
  shop_id      uuid references public.shops(id) on delete cascade,
  days_granted integer not null,
  redeemed_at  timestamptz not null default now(),
  unique (coupon_id, shop_id)   -- a shop can't redeem the same coupon twice
);

alter table public.plan_coupons enable row level security;
alter table public.plan_coupon_redemptions enable row level security;
-- No policies on purpose: only the service role (server routes) touches these.
