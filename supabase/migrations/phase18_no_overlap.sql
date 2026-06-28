-- phase18_no_overlap.sql
-- Authoritative, DB-level guard against double-booking a barber.
--
-- The existing unique index only blocks an IDENTICAL start slot. This trigger
-- blocks any OVERLAP: a new/edited active (pending|confirmed) appointment that
-- runs into another active appointment for the same barber on the same day is
-- rejected — no matter which code path writes it (online booking, walk-in seat,
-- waitlist accept, manual add, or an edit). Cancelled / completed / no-show rows
-- don't hold a slot, so they're never checked and never block.
--
-- Safe to run multiple times.

-- "9:00 AM" / "12:30 PM" → minutes from midnight. Returns NULL (instead of
-- erroring) if a row's time_slot is in some unexpected format, so a stray value
-- can never make the whole INSERT/UPDATE fail.
create or replace function public.clipwise_slot_minutes(slot text)
returns int language plpgsql immutable as $$
declare t time;
begin
  begin
    t := to_timestamp(slot, 'HH12:MI AM')::time;
  exception when others then
    return null;
  end;
  return extract(hour from t)::int * 60 + extract(minute from t)::int;
end;
$$;

create or replace function public.clipwise_prevent_overlap()
returns trigger language plpgsql as $$
declare
  new_start int;
  new_dur int;
  new_end int;
begin
  -- Only active bookings hold a chair.
  if NEW.status is null or NEW.status not in ('pending', 'confirmed') then
    return NEW;
  end if;
  -- Can't range-check an unassigned ("any") barber.
  if NEW.barber_id is null then
    return NEW;
  end if;

  new_start := public.clipwise_slot_minutes(NEW.time_slot);
  if new_start is null then
    return NEW; -- unparseable time — don't block, let other guards handle it
  end if;
  new_dur := coalesce(
    NEW.duration_minutes,
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
      and a.status in ('pending', 'confirmed')
      and public.clipwise_slot_minutes(a.time_slot) is not null
      and new_start < public.clipwise_slot_minutes(a.time_slot)
                      + coalesce(a.duration_minutes,
                                 (select duration_minutes from public.services where id = a.service_id),
                                 30)
      and new_end > public.clipwise_slot_minutes(a.time_slot)
  ) then
    raise exception 'OVERLAP: that time overlaps another booking for this barber'
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_clipwise_prevent_overlap on public.appointments;
create trigger trg_clipwise_prevent_overlap
  before insert or update on public.appointments
  for each row execute function public.clipwise_prevent_overlap();
