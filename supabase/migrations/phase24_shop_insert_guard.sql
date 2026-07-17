-- phase24_shop_insert_guard.sql
-- Defense-in-depth for shop creation. The app now creates shops through the
-- server route /api/shops/create (service role), which verifies the Stripe
-- subscription before granting an approved/paid shop. But the shops_insert_owner
-- RLS still lets a user INSERT their own shop directly with the anon key, and
-- the existing escalation guard is BEFORE UPDATE only — so a crafted insert
-- could still set status='approved' / subscription_status='active'.
--
-- This BEFORE INSERT trigger clamps those two fields to safe values ONLY for
-- direct end-user inserts (auth.uid() is not null). The trusted server route
-- runs as the service role (auth.uid() is null) and is exempt, so real
-- paid/approved shops still go through. Safe to run repeatedly.

create or replace function public.clamp_shop_self_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is NULL under the service role (our trusted server route) and
  -- non-null for a direct anon-key insert by an end user.
  if auth.uid() is not null then
    new.status := 'pending';
    new.subscription_status := 'inactive';
  end if;
  return new;
end;
$$;

drop trigger if exists clamp_shop_self_insert_trg on public.shops;
create trigger clamp_shop_self_insert_trg
  before insert on public.shops
  for each row execute function public.clamp_shop_self_insert();
