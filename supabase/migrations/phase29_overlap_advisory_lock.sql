-- phase29_overlap_advisory_lock.sql
-- Close the double-booking race in clipwise_prevent_overlap().
-- The overlap check is a plain SELECT; under READ COMMITTED two concurrent
-- inserts for the same barber+day don't see each other's uncommitted rows and
-- could both pass. A transaction-scoped advisory lock keyed on (barber, date)
-- serializes exactly those conflicting inserts (nothing else), so the second
-- transaction runs its check after the first commits and correctly blocks.
-- Safe to re-run (CREATE OR REPLACE).
create or replace function public.clipwise_prevent_overlap()
returns trigger
language plpgsql
as $function$
declare
  new_start int;
  new_dur int;
  new_end int;
begin
  if NEW.status is null or NEW.status in ('cancelled', 'no-show') then
    return NEW;
  end if;
  if NEW.barber_id is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE'
     and OLD.barber_id is not distinct from NEW.barber_id
     and OLD.date is not distinct from NEW.date
     and OLD.time_slot is not distinct from NEW.time_slot
     and (to_jsonb(OLD) ->> 'duration_minutes') is not distinct from (to_jsonb(NEW) ->> 'duration_minutes')
  then
    return NEW;
  end if;

  -- Serialize concurrent bookings for the SAME barber on the SAME day. Held
  -- until the transaction ends; only same-barber-same-day inserts contend.
  perform pg_advisory_xact_lock(hashtext(NEW.barber_id::text || '|' || NEW.date::text));

  new_start := public.clipwise_slot_minutes(NEW.time_slot);
  if new_start is null then
    return NEW;
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
