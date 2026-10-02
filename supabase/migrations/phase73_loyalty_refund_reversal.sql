-- phase73 — a refunded visit gives its points back (and takes back what it earned)
--
-- Why (2026-10-02 smoke test, owner decision): a $15.93 visit paid with 423
-- points was fully refunded. The customer kept the 31 points the visit earned
-- and never got the 423 spent points back — a refund didn't touch points at all.
--
-- What: loyalty_sync_appointment (phase68) now treats a visit as UNDONE when it
-- is cancelled / no-show OR its payment is refunded, and syncs BOTH sides:
--   * points SPENT on it   → given back ('restored'), as before for cancel/no-show
--   * points EARNED by it  → taken back ('revoked'), capped at the balance so it
--     never goes negative (points already spent elsewhere stay spent)
-- Reinstating a visit re-applies both ('reapplied' / 'reearned'). The trigger now
-- also fires on payment_status, so every refund path (Payments, calendar,
-- appointments page, Stripe webhook) is covered by the table itself. Only the
-- difference is ever applied, under a row lock — retries and double-fires are
-- no-ops.
--
-- Additive; server-only. Existing ledger rows are untouched.

create or replace function public.loyalty_sync_appointment(p_appointment_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_status text; v_pay text; v_undone boolean;
        v_shop uuid; v_client uuid; v_orig integer; v_net integer; v_target integer;
        v_applied integer; v_total integer := 0;
begin
  select a.status, a.payment_status into v_status, v_pay
  from public.appointments a where a.id = p_appointment_id for update;
  if not found then return 0; end if;
  v_undone := v_status in ('cancelled', 'no-show') or v_pay = 'refunded';

  -- Points SPENT on this visit: kept while it stands, given back when undone.
  select r.shop_id, r.client_id, -r.points into v_shop, v_client, v_orig
  from public.loyalty_rewards r where r.appointment_id = p_appointment_id and r.action = 'redeemed';
  if found then
    select coalesce(sum(r.points), 0) into v_net from public.loyalty_rewards r
    where r.appointment_id = p_appointment_id and r.action in ('redeemed', 'restored', 'reapplied');
    v_target := case when v_undone then 0 else -v_orig end;
    if v_target <> v_net then
      select a.applied into v_applied from public.loyalty_adjust(
        v_shop, v_client, v_target - v_net,
        case when v_target > v_net then 'restored' else 'reapplied' end, p_appointment_id) a;
      v_total := v_total + coalesce(v_applied, 0);
    end if;
  end if;

  -- Points EARNED by this visit: kept while it stands, taken back when undone.
  select r.shop_id, r.client_id, r.points into v_shop, v_client, v_orig
  from public.loyalty_rewards r where r.appointment_id = p_appointment_id and r.action = 'earned';
  if found then
    select coalesce(sum(r.points), 0) into v_net from public.loyalty_rewards r
    where r.appointment_id = p_appointment_id and r.action in ('earned', 'revoked', 'reearned');
    v_target := case when v_undone then 0 else v_orig end;
    if v_target <> v_net then
      select a.applied into v_applied from public.loyalty_adjust(
        v_shop, v_client, v_target - v_net,
        case when v_target < v_net then 'revoked' else 'reearned' end, p_appointment_id) a;
      v_total := v_total + coalesce(v_applied, 0);
    end if;
  end if;
  return v_total;
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
            left('Loyalty points not synced for appointment ' || new.id || ' (status ' || new.status
                 || ', payment ' || coalesce(new.payment_status, '-') || '): ' || sqlerrm, 300),
            'loyalty_on_appointment_status', new.shop_id);
  end;
  return new;
end $$;

drop trigger if exists trg_loyalty_on_appointment_status on public.appointments;
create trigger trg_loyalty_on_appointment_status
  after update of status, payment_status on public.appointments
  for each row when (old.status is distinct from new.status or old.payment_status is distinct from new.payment_status)
  execute function public.loyalty_on_appointment_status();

revoke all on function public.loyalty_sync_appointment(uuid) from public, anon, authenticated;
revoke all on function public.loyalty_on_appointment_status() from public, anon, authenticated;
grant execute on function public.loyalty_sync_appointment(uuid) to service_role;

-- Already-refunded visits: bring them in line now (idempotent).
select public.loyalty_sync_appointment(a.id)
from public.appointments a
where a.payment_status = 'refunded'
  and exists (select 1 from public.loyalty_rewards r where r.appointment_id = a.id);

-- ROLLBACK: re-run the loyalty_sync_appointment / trigger definitions from
-- phase68_loyalty_ledger_integrity.sql (status-only, spent points only).
