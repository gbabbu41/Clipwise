-- phase16 — link notifications to the thing they're about, so the owner can
-- act (Approve / Decline) on a booking straight from the notification sheet.
--
-- Additive + nullable: existing notifications keep working. Code paths that read
-- or write these columns fall back gracefully if this hasn't been run yet, so
-- there's no hard dependency — but inline Approve/Decline only lights up once
-- this is applied.
alter table public.notifications add column if not exists entity_type text;  -- e.g. 'appointment'
alter table public.notifications add column if not exists entity_id   uuid;  -- the appointment id

-- Helps the (rare) lookups that filter by the referenced entity.
create index if not exists notifications_entity_idx
  on public.notifications (entity_type, entity_id);
