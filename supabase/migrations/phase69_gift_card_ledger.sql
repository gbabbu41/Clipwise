-- phase69 — gift-card money can't be lost or double-spent
--
-- Why (2026-09-28 audit): a gift card is stored money, but
--  * a booking paid by gift card didn't record WHICH card paid, so cancelling it
--    could never give the value back (the customer's money was simply gone);
--  * the POS read-modify-wrote the balance (two sales at once could both spend it);
--  * no history: remaining_value changed with no record of where the money went.
--
-- What:
--  1. gift_card_ledger — every spend / give-back, linked to the card and booking.
--  2. gift_adjust() — the ONE way a card balance changes: row-locks the card,
--     never overdraws (all-or-nothing when p_require_full), never refunds above
--     the card's original value, writes balance + ledger row together. One
--     'redeemed' row per booking, so a retry can't spend twice.
--  3. gift_redeem_for_appointment() — spends a card for a booking only while the
--     booking is still active.
--  4. gift_sync_appointment() + trigger — a CANCELLED booking gives its gift value
--     back to the card (every path: customer, owner calendar, API, future code);
--     reinstating it spends it again. A NO-SHOW keeps it, like a prepaid card
--     payment. Never blocks the status change: failures go to error_logs.
--
-- Additive only; existing cards and bookings are unchanged. Server-only functions.

create table if not exists public.gift_card_ledger (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  gift_card_id uuid not null references public.gift_cards(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  amount numeric(10,2) not null,          -- negative = spent, positive = given back
  action text not null,                   -- redeemed | restored | reapplied
  created_at timestamptz not null default now()
);
alter table public.gift_card_ledger enable row level security;   -- server-only (no policies)
create unique index if not exists gift_card_ledger_one_redeem_per_booking
  on public.gift_card_ledger (appointment_id) where appointment_id is not null and action = 'redeemed';
create index if not exists gift_card_ledger_card_idx on public.gift_card_ledger (gift_card_id);
create index if not exists gift_card_ledger_appointment_idx
  on public.gift_card_ledger (appointment_id) where appointment_id is not null;

create or replace function public.gift_adjust(
  p_shop_id uuid, p_gift_card_id uuid, p_delta numeric, p_action text,
  p_appointment_id uuid default null, p_require_full boolean default false
) returns table (applied numeric, balance numeric)
language plpgsql security definer set search_path = public as $$
declare v_bal numeric; v_init numeric; v_active boolean; v_applied numeric;
begin
  select round(coalesce(g.remaining_value, 0), 2), round(coalesce(g.initial_value, 0), 2), coalesce(g.is_active, false)
    into v_bal, v_init, v_active
  from public.gift_cards g where g.id = p_gift_card_id and g.shop_id = p_shop_id for update;
  if not found then raise exception 'gift card not found' using errcode = 'P0002'; end if;

  if p_delta < 0 then
    if not v_active or v_bal <= 0 then return query select 0::numeric, v_bal; return; end if;
    if p_require_full and v_bal < round(-p_delta, 2) then return query select 0::numeric, v_bal; return; end if;
    v_applied := -least(v_bal, round(-p_delta, 2));
  else
    v_applied := least(round(p_delta, 2), greatest(v_init - v_bal, 0));   -- never above the card's value
  end if;
  if v_applied = 0 then return query select 0::numeric, v_bal; return; end if;

  begin
    insert into public.gift_card_ledger (shop_id, gift_card_id, appointment_id, amount, action)
    values (p_shop_id, p_gift_card_id, p_appointment_id, v_applied, p_action);
  exception when unique_violation then
    return query select 0::numeric, v_bal; return;   -- already spent for this booking
  end;
  update public.gift_cards set
    remaining_value = v_bal + v_applied,
    -- emptied → inactive; given back from empty → active again. A card the owner
    -- deactivated while it still had value stays deactivated.
    is_active = case when v_bal + v_applied <= 0 then false when v_bal <= 0 then true else is_active end,
    redeemed_at = case when v_applied < 0 then now() else redeemed_at end
  where id = p_gift_card_id;
  return query select v_applied, v_bal + v_applied;
end $$;

create or replace function public.gift_redeem_for_appointment(
  p_shop_id uuid, p_code text, p_amount numeric, p_appointment_id uuid, p_require_full boolean default false
) returns table (applied numeric, balance numeric)
language plpgsql security definer set search_path = public as $$
declare v_status text; v_card uuid;
begin
  select a.status into v_status from public.appointments a
  where a.id = p_appointment_id and a.shop_id = p_shop_id for update;
  if not found or v_status = 'cancelled' then return query select 0::numeric, null::numeric; return; end if;
  select g.id into v_card from public.gift_cards g where g.shop_id = p_shop_id and g.code = p_code;
  if not found then return query select 0::numeric, null::numeric; return; end if;
  return query select * from public.gift_adjust(p_shop_id, v_card, -p_amount, 'redeemed', p_appointment_id, p_require_full);
end $$;

create or replace function public.gift_sync_appointment(p_appointment_id uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_status text; v_shop uuid; v_card uuid; v_orig numeric; v_net numeric; v_target numeric; v_applied numeric;
begin
  select a.status into v_status from public.appointments a where a.id = p_appointment_id for update;
  if not found then return 0; end if;
  select l.shop_id, l.gift_card_id, -l.amount into v_shop, v_card, v_orig
  from public.gift_card_ledger l where l.appointment_id = p_appointment_id and l.action = 'redeemed';
  if not found then return 0; end if;   -- not paid by gift card
  select coalesce(sum(l.amount), 0) into v_net from public.gift_card_ledger l
  where l.appointment_id = p_appointment_id and l.action in ('redeemed', 'restored', 'reapplied');
  v_target := case when v_status = 'cancelled' then 0 else -v_orig end;
  if v_target = v_net then return 0; end if;
  select a.applied into v_applied from public.gift_adjust(
    v_shop, v_card, v_target - v_net,
    case when v_target > v_net then 'restored' else 'reapplied' end, p_appointment_id) a;
  return v_applied;
end $$;

create or replace function public.gift_on_appointment_status()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.gift_sync_appointment(new.id);
  exception when others then
    insert into public.error_logs (level, source, message, path, shop_id)
    values ('error', 'gift-sync',
            left('Gift card not synced for appointment ' || new.id || ' (status ' || new.status || '): ' || sqlerrm, 300),
            'gift_on_appointment_status', new.shop_id);
  end;
  return new;
end $$;

drop trigger if exists trg_gift_on_appointment_status on public.appointments;
create trigger trg_gift_on_appointment_status
  after update of status on public.appointments
  for each row when (old.status is distinct from new.status)
  execute function public.gift_on_appointment_status();

revoke all on function public.gift_adjust(uuid, uuid, numeric, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.gift_redeem_for_appointment(uuid, text, numeric, uuid, boolean) from public, anon, authenticated;
revoke all on function public.gift_sync_appointment(uuid) from public, anon, authenticated;
revoke all on function public.gift_on_appointment_status() from public, anon, authenticated;
grant execute on function public.gift_adjust(uuid, uuid, numeric, text, uuid, boolean) to service_role;
grant execute on function public.gift_redeem_for_appointment(uuid, text, numeric, uuid, boolean) to service_role;
grant execute on function public.gift_sync_appointment(uuid) to service_role;

-- ROLLBACK (keeps card balances as they are):
-- drop trigger if exists trg_gift_on_appointment_status on public.appointments;
-- drop function if exists public.gift_on_appointment_status(), public.gift_sync_appointment(uuid),
--   public.gift_redeem_for_appointment(uuid, text, numeric, uuid, boolean),
--   public.gift_adjust(uuid, uuid, numeric, text, uuid, boolean);
-- drop table if exists public.gift_card_ledger;
