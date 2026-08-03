-- phase39: stop a barber from self-granting permissions
--
-- RLS policy barbers_update_owner allows a barber to UPDATE their own row, and
-- the restrict_barber_self_update() trigger blocks the sensitive columns
-- (is_active, commission_percent, rating, total_reviews, shop_id, user_id) — but
-- it did NOT block `permissions`. So a signed-in barber could run
--   update barbers set permissions = '{"manage_appointments":true,...}' where id = <own id>
-- and grant themselves anything, defeating every server-side permission check
-- that reads barbers.permissions (including capture-appointment, which would then
-- let them charge customers' cards).
--
-- Add `permissions` to the forbidden-on-self-update set. Only the shop owner (or
-- a super admin) can change a barber's permissions. Idempotent (CREATE OR REPLACE).

create or replace function public.restrict_barber_self_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Only restrict when the caller is the barber themselves,
  -- not the shop owner and not an admin.
  if auth.uid() = old.user_id
     and not public.is_super_admin()
     and not exists(
       select 1 from public.shops
       where id = old.shop_id and owner_id = auth.uid()
     )
  then
    if old.is_active is distinct from new.is_active then
      raise exception 'Permission denied: is_active can only be changed by the shop owner';
    end if;
    if old.commission_percent is distinct from new.commission_percent then
      raise exception 'Permission denied: commission can only be changed by the shop owner';
    end if;
    if old.rating is distinct from new.rating then
      raise exception 'Permission denied: rating cannot be manually changed';
    end if;
    if old.total_reviews is distinct from new.total_reviews then
      raise exception 'Permission denied: total_reviews cannot be manually changed';
    end if;
    if old.shop_id is distinct from new.shop_id then
      raise exception 'Permission denied: cannot change shop assignment';
    end if;
    if old.user_id is distinct from new.user_id then
      raise exception 'Permission denied: cannot transfer barber account';
    end if;
    if old.permissions is distinct from new.permissions then
      raise exception 'Permission denied: permissions can only be changed by the shop owner';
    end if;
  end if;
  return new;
end;
$function$;
