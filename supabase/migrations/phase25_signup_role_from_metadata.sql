-- phase25_signup_role_from_metadata.sql
-- Fixes: a shop owner's role was lost on the email-confirmation signup path.
-- Role used to be written by a client-side update that only runs when a session
-- exists immediately; with "confirm email" on there's no session, so the row was
-- created as the default 'customer' and the owner could never reach onboarding.
--
-- Now handle_new_user reads the intended role from signup metadata
-- (raw_user_meta_data.role, set by the signup form) and applies it at account
-- creation — WHITELISTED to self-selectable roles so a crafted signup payload
-- can never grant super_admin. Safe to run repeatedly.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data->>'role', 'customer');
  safe_role text;
begin
  -- Only roles a user may pick for themselves. super_admin is never grantable here.
  safe_role := case when requested_role in ('customer', 'shop_owner', 'barber') then requested_role else 'customer' end;

  insert into public.users (id, email, name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    safe_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
