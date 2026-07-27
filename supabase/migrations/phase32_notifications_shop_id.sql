-- phase32_notifications_shop_id.sql
-- Scope notifications per shop. A multi-shop owner owns every shop under ONE
-- user_id, and notifications were keyed only to user_id — so every shop's alerts
-- bled into each other (dashboard "recent alerts", the bell badge, the notif
-- sheet, realtime pop-ups, and the full Notifications page all showed both
-- shops). This adds a shop_id so alerts can be attributed to (and filtered by)
-- the shop they belong to.
--
-- Safe to run multiple times.

alter table public.notifications
  add column if not exists shop_id uuid references public.shops(id) on delete cascade;

create index if not exists notifications_shop_id_idx on public.notifications(shop_id);

-- Backfill existing rows where the shop is UNAMBIGUOUS:
--  · recipient owns exactly one shop  → that shop
--  · recipient is a barber at exactly one shop → that shop
-- Rows for a multi-shop owner stay NULL (can't be attributed retroactively);
-- the app keeps NULL rows visible on every shop so none disappear.
update public.notifications n
set shop_id = s.id
from public.shops s
where n.shop_id is null
  and s.owner_id = n.user_id
  and (select count(*) from public.shops s2 where s2.owner_id = n.user_id) = 1;

update public.notifications n
set shop_id = b.shop_id
from public.barbers b
where n.shop_id is null
  and b.user_id = n.user_id
  and (select count(*) from public.barbers b2 where b2.user_id = n.user_id) = 1;
