-- phase23_promo_redemptions.sql
-- Promo codes were validated + discounted entirely client-side: the usage cap
-- (uses_left) was never checked or decremented, and a code could be reused
-- forever. This ledger makes enforcement real + server-authoritative:
--   • one row per redemption (who used which code, on which appointment)
--   • unique (code, email) / (code, phone)  → ONCE PER CUSTOMER
--   • unique (code, appointment)            → idempotent consume
-- The API decrements promo_codes.uses_left / bumps total_uses on redemption.
-- Safe to run repeatedly.

create table if not exists public.promo_redemptions (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  promo_code_id uuid references public.promo_codes(id) on delete cascade,
  code text,
  client_email text,
  client_phone text,
  appointment_id uuid references public.appointments(id) on delete set null,
  created_at timestamptz default now()
);

-- Once per customer, per code (by email OR phone — partial so nulls don't clash).
create unique index if not exists promo_redemptions_code_email_idx
  on public.promo_redemptions (promo_code_id, lower(client_email)) where client_email is not null and client_email <> '';
create unique index if not exists promo_redemptions_code_phone_idx
  on public.promo_redemptions (promo_code_id, client_phone) where client_phone is not null and client_phone <> '';
-- Idempotency: a given appointment consumes a code at most once.
create unique index if not exists promo_redemptions_code_appt_idx
  on public.promo_redemptions (promo_code_id, appointment_id) where appointment_id is not null;

alter table public.promo_redemptions enable row level security;

-- Writes happen through service-role API routes; owners can read for reporting.
drop policy if exists "promo_redemptions_owner_read" on public.promo_redemptions;
create policy "promo_redemptions_owner_read" on public.promo_redemptions for select using (
  exists(select 1 from public.shops where id = promo_redemptions.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);
