-- phase68 — loyalty points can't silently disappear (or double up)
--
-- Why: a customer redeemed 423 points on a pay-at-shop booking, the booking was
-- cancelled 4 minutes later, and the points were gone for good — nothing linked
-- the redemption to the booking and no cancel path gave points back. Balances
-- were also read-modify-written from several places (earn, redeem, manual), so
-- two at once could lose one; and ledger writes failed silently.
--
-- What:
--  1. loyalty_rewards.appointment_id — which booking earned/spent the points.
--  2. loyalty_adjust()  — the ONE way a balance changes: row-locks the client,
--     clamps a deduction at the real balance (never negative), writes balance +
--     ledger row in the same transaction. At most one 'earned' and one 'redeemed'
--     row per booking (unique index), so a retry/double-fire applies once.
--  3. loyalty_sync_appointment() + trigger — whenever a booking's status changes,
--     its redemption is brought in line: cancelled / no-show → points given back
--     ('restored'); reinstated → re-applied ('reapplied', capped at the balance).
--     Works for EVERY path (customer cancel, owner calendar, API, future code)
--     because it lives on the table. Never blocks the status change: a failure is
--     written to error_logs.
--  4. loyalty_redeem_for_appointment() — spends points for a booking only while
--     it is still active (a booking cancelled first is never charged points).
--
-- Additive only: no existing row is changed. Safe to run before or after the app
-- code that calls these functions. Run the whole file once in the SQL editor.

alter table public.loyalty_rewards
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

create unique index if not exists loyalty_rewards_one_earn_per_booking
  on public.loyalty_rewards (appointment_id) where appointment_id is not null and action = 'earned';
create unique index if not exists loyalty_rewards_one_redeem_per_booking
  on public.loyalty_rewards (appointment_id) where appointment_id is not null and action = 'redeemed';
create index if not exists loyalty_rewards_appointment_idx
  on public.loyalty_rewards (appointment_id) where appointment_id is not null;

-- The single, atomic way to change a balance. p_delta > 0 credits; p_delta < 0
-- deducts min(balance, |p_delta|) — or, with p_strict, refuses (22003) when the
-- balance is short. Returns what was actually applied and the new balance.
-- A duplicate 'earned'/'redeemed' for the same booking applies nothing.
create or replace function public.loyalty_adjust(
  p_shop_id uuid, p_client_id uuid, p_delta integer, p_action text,
  p_appointment_id uuid default null, p_strict boolean default false
) returns table (applied integer, balance integer)
language plpgsql security definer set search_path = public as $$
declare v_bal integer; v_applied integer;
begin
  select coalesce(c.loyalty_points, 0) into v_bal
  from public.clients c where c.id = p_client_id and c.shop_id = p_shop_id for update;
  if not found then raise exception 'loyalty client not found' using errcode = 'P0002'; end if;

  if p_delta < 0 and p_strict and v_bal < -p_delta then
    raise exception 'not enough loyalty points' using errcode = '22003';
  end if;
  v_applied := case when p_delta < 0 then -least(greatest(v_bal, 0), -p_delta) else p_delta end;
  if v_applied = 0 then return query select 0, v_bal; return; end if;

  begin
    insert into public.loyalty_rewards (shop_id, client_id, points, action, appointment_id)
    values (p_shop_id, p_client_id, v_applied, p_action, p_appointment_id);
  exception when unique_violation then
    return query select 0, v_bal; return;   -- already applied for this booking
  end;
  update public.clients set loyalty_points = v_bal + v_applied where id = p_client_id;
  return query select v_applied, v_bal + v_applied;
end $$;

-- Bring a booking's points in line with its status: an active/completed booking
-- keeps its redemption spent; a cancelled / no-show booking gets it back. Safe to
-- call any number of times (it only applies the difference, under a row lock).
create or replace function public.loyalty_sync_appointment(p_appointment_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_status text; v_orig integer; v_net integer; v_target integer;
        v_shop uuid; v_client uuid; v_applied integer;
begin
  select a.status into v_status from public.appointments a where a.id = p_appointment_id for update;
  if not found then return 0; end if;

  select r.shop_id, r.client_id, -r.points into v_shop, v_client, v_orig
  from public.loyalty_rewards r where r.appointment_id = p_appointment_id and r.action = 'redeemed';
  if not found then return 0; end if;   -- this booking spent no points

  select coalesce(sum(r.points), 0) into v_net from public.loyalty_rewards r
  where r.appointment_id = p_appointment_id and r.action in ('redeemed', 'restored', 'reapplied');
  v_target := case when v_status in ('cancelled', 'no-show') then 0 else -v_orig end;
  if v_target = v_net then return 0; end if;

  select a.applied into v_applied from public.loyalty_adjust(
    v_shop, v_client, v_target - v_net,
    case when v_target > v_net then 'restored' else 'reapplied' end, p_appointment_id) a;
  return v_applied;
end $$;

create or replace function public.loyalty_on_appointment_status()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.loyalty_sync_appointment(new.id);
  exception when others then
    insert into public.error_logs (level, source, message, path, shop_id)
    values ('error', 'loyalty-sync',
            left('Loyalty points not synced for appointment ' || new.id || ' (status ' || new.status || '): ' || sqlerrm, 300),
            'loyalty_on_appointment_status', new.shop_id);
  end;
  return new;
end $$;

drop trigger if exists trg_loyalty_on_appointment_status on public.appointments;
create trigger trg_loyalty_on_appointment_status
  after update of status on public.appointments
  for each row when (old.status is distinct from new.status)
  execute function public.loyalty_on_appointment_status();

-- Spend points for a booking — only while it's still active, once per booking.
create or replace function public.loyalty_redeem_for_appointment(
  p_shop_id uuid, p_client_id uuid, p_points integer, p_appointment_id uuid
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_status text; v_applied integer;
begin
  if p_points is null or p_points <= 0 then return 0; end if;
  select a.status into v_status from public.appointments a
  where a.id = p_appointment_id and a.shop_id = p_shop_id for update;
  if not found or v_status in ('cancelled', 'no-show') then return 0; end if;
  select a.applied into v_applied
  from public.loyalty_adjust(p_shop_id, p_client_id, -p_points, 'redeemed', p_appointment_id) a;
  return -v_applied;
end $$;

revoke all on function public.loyalty_adjust(uuid, uuid, integer, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.loyalty_sync_appointment(uuid) from public, anon, authenticated;
revoke all on function public.loyalty_redeem_for_appointment(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.loyalty_on_appointment_status() from public, anon, authenticated;
grant execute on function public.loyalty_adjust(uuid, uuid, integer, text, uuid, boolean) to service_role;
grant execute on function public.loyalty_sync_appointment(uuid) to service_role;
grant execute on function public.loyalty_redeem_for_appointment(uuid, uuid, integer, uuid) to service_role;

-- Verify (expect 3 functions, 1 trigger, 2 unique indexes):
-- select proname from pg_proc where proname in ('loyalty_adjust','loyalty_sync_appointment','loyalty_redeem_for_appointment');
-- select tgname from pg_trigger where tgname = 'trg_loyalty_on_appointment_status';
-- select indexname from pg_indexes where indexname like 'loyalty_rewards_one_%';
--
-- ROLLBACK (keeps all ledger rows; the app falls back to failing loudly on the RPC):
-- drop trigger if exists trg_loyalty_on_appointment_status on public.appointments;
-- drop function if exists public.loyalty_on_appointment_status(), public.loyalty_sync_appointment(uuid),
--   public.loyalty_redeem_for_appointment(uuid, uuid, integer, uuid),
--   public.loyalty_adjust(uuid, uuid, integer, text, uuid, boolean);
-- drop index if exists public.loyalty_rewards_one_earn_per_booking, public.loyalty_rewards_one_redeem_per_booking,
--   public.loyalty_rewards_appointment_idx;
-- alter table public.loyalty_rewards drop column if exists appointment_id;
