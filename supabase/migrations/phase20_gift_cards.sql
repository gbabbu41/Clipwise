-- phase20_gift_cards.sql
-- The Gift Cards dashboard reads/writes public.gift_cards, but the table only
-- ever existed in the demo DB — it was never added to prod, so the whole
-- feature errored (load returned nothing, "Issue" failed). This creates it with
-- owner-scoped RLS mirroring promo_codes/transactions. Safe to run repeatedly.

create table if not exists public.gift_cards (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  code text not null,
  initial_value numeric(10,2) not null default 0,
  remaining_value numeric(10,2) not null default 0,
  purchased_by text,
  purchased_by_email text,
  recipient_name text,
  recipient_email text,
  note text,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  redeemed_at timestamptz
);

-- One code per shop; also speeds up the redeem lookup by (shop_id, code).
create unique index if not exists gift_cards_shop_code_idx on public.gift_cards (shop_id, upper(code));

alter table public.gift_cards enable row level security;

-- The owner of the shop can do everything with their own gift cards. (All
-- issuance/redemption happens from the authenticated owner dashboard.)
drop policy if exists "gift_cards_manage_owner" on public.gift_cards;
create policy "gift_cards_manage_owner" on public.gift_cards for all using (
  exists(select 1 from public.shops where id = gift_cards.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
) with check (
  exists(select 1 from public.shops where id = gift_cards.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);
