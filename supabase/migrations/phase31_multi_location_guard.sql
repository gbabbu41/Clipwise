-- phase31_multi_location_guard.sql
-- Hard, DB-level block on multi-location for plans that don't include it.
-- Multiple locations are a Premium+ feature. The app UI already hides the
-- "Add Location" button for Pro/Starter, but the settings page inserts the new
-- shop DIRECTLY with the anon key (auth.uid() not null), so a crafted insert
-- could still create a second shop. phase24 only CLAMPS status/subscription on
-- such inserts — it doesn't stop them.
--
-- This BEFORE INSERT trigger blocks a SECOND (or later) shop for an owner whose
-- plan isn't Premium/Business. The first shop is always allowed. The trusted
-- server route /api/shops/create runs as the service role (auth.uid() is null)
-- and is exempt, so real onboarding + any future server-side multi-location
-- provisioning still work. Idempotent — safe to run repeatedly.

create or replace function public.guard_multi_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_count int;
  has_multi boolean;
begin
  -- Only guard direct end-user inserts; the trusted service-role route is exempt.
  if auth.uid() is null then
    return new;
  end if;

  select count(*) into existing_count from public.shops where owner_id = new.owner_id;
  if existing_count = 0 then
    return new;  -- an owner's first shop is always allowed
  end if;

  -- Adding another location requires an ACTIVE Premium/Business plan on any of
  -- the owner's existing shops (multi_location is a Premium+ feature).
  select exists (
    select 1 from public.shops
    where owner_id = new.owner_id
      and subscription_status = 'active'
      and subscription_plan in ('premium', 'business')
  ) into has_multi;

  if not has_multi then
    raise exception 'Multiple locations require the Premium plan'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_multi_location_trg on public.shops;
create trigger guard_multi_location_trg
  before insert on public.shops
  for each row execute function public.guard_multi_location();
