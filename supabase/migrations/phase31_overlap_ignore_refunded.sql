-- phase31_overlap_ignore_refunded.sql
-- Make the DB overlap guard agree with the app's universal occupancy rule:
-- a REFUNDED booking no longer holds its chair — even one that was checked out
-- early (status 'completed') and then refunded. Without this, the overlap
-- trigger still counts a refunded 'completed' row as occupying, so nobody
-- (customer OR owner) can re-book that freed slot — the insert is rejected with
-- "OVERLAP" even though the app already treats the time as free.
--
-- This is a create-or-replace of the SAME function you already run — it PRESERVES
-- the phase29 concurrency advisory lock and the search_path hardening, and only
-- adds the two 'refunded' conditions. Function-only replace (the phase18 trigger
-- keeps pointing at it), so there's never a window where the guard is off.
--
-- Only the overlap trigger needs changing: the phase4 unique index is scoped to
-- ('pending','confirmed') and never sees a refunded/completed row.
--
-- Safe to run multiple times.

create or replace function public.clipwise_prevent_overlap()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  new_start int;
  new_dur int;
  new_end int;
begin
  -- A cancelled / no-show / REFUNDED row frees its slot — never guard it.
  if NEW.status is null
     or NEW.status in ('cancelled', 'no-show')
     or (to_jsonb(NEW) ->> 'payment_status') = 'refunded' then
    return NEW;
  end if;
  -- Can't range-check an unassigned ("any") barber.
  if NEW.barber_id is null then
    return NEW;
  end if;
  -- On UPDATE, only check when the time window actually MOVES.
  if TG_OP = 'UPDATE'
     and OLD.barber_id is not distinct from NEW.barber_id
     and OLD.date is not distinct from NEW.date
     and OLD.time_slot is not distinct from NEW.time_slot
     and (to_jsonb(OLD) ->> 'duration_minutes') is not distinct from (to_jsonb(NEW) ->> 'duration_minutes')
  then
    return NEW;
  end if;
  -- phase29: serialize concurrent inserts for the same barber+date so two
  -- simultaneous bookings can't both pass the check below.
  perform pg_advisory_xact_lock(hashtext(NEW.barber_id::text || '|' || NEW.date::text));
  new_start := public.clipwise_slot_minutes(NEW.time_slot);
  if new_start is null then
    return NEW; -- unparseable time — don't block, let other guards handle it
  end if;
  new_dur := coalesce(
    nullif(to_jsonb(NEW) ->> 'duration_minutes', '')::int,
    (select duration_minutes from public.services where id = NEW.service_id),
    30
  );
  new_end := new_start + greatest(new_dur, 1);
  if exists (
    select 1
    from public.appointments a
    where a.id <> NEW.id
      and a.barber_id = NEW.barber_id
      and a.date = NEW.date
      and a.status not in ('cancelled', 'no-show')
      and coalesce(a.payment_status, '') <> 'refunded'   -- a refunded row frees its chair
      and public.clipwise_slot_minutes(a.time_slot) is not null
      and new_start < public.clipwise_slot_minutes(a.time_slot)
                      + coalesce(nullif(to_jsonb(a) ->> 'duration_minutes', '')::int,
                                 (select duration_minutes from public.services where id = a.service_id),
                                 30)
      and new_end > public.clipwise_slot_minutes(a.time_slot)
  ) then
    raise exception 'OVERLAP: that time overlaps another booking for this barber'
      using errcode = 'P0001';
  end if;
  return NEW;
end;
$function$;
