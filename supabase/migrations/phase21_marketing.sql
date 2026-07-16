-- phase21_marketing.sql
-- Marketing campaigns SEND real email, but the history + stats on the Marketing
-- page were hardcoded mock rows — a sent campaign was never recorded, so the
-- owner never saw their real sends. This adds a campaigns table to persist each
-- send, plus a per-client marketing opt-out for one-click unsubscribe (CASL /
-- CAN-SPAM). Safe to run repeatedly.

create table if not exists public.campaigns (
  id uuid default gen_random_uuid() primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  name text,
  segment text,
  subject text,
  recipients integer not null default 0,
  status text not null default 'sent',
  sent_at timestamptz default now()
);

create index if not exists campaigns_shop_sent_idx on public.campaigns (shop_id, sent_at desc);

alter table public.campaigns enable row level security;

drop policy if exists "campaigns_manage_owner" on public.campaigns;
create policy "campaigns_manage_owner" on public.campaigns for all using (
  exists(select 1 from public.shops where id = campaigns.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
) with check (
  exists(select 1 from public.shops where id = campaigns.shop_id and owner_id = auth.uid())
  or public.is_super_admin()
);

-- One-click unsubscribe target. Defaults false so existing clients stay opted in.
alter table public.clients add column if not exists marketing_opt_out boolean not null default false;
