-- phase75 — refunds go back the way the money came in (gift card, cash, split)
--
-- Why (owner decision 2026-10-03): a refund only knew one way back — Stripe, on
-- the booking's own card charge. A visit paid by gift card, by cash, or split
-- (gift card + card/cash for the rest) couldn't be refunded from the app, and a
-- gift-card SALE couldn't be refunded at all.
--
-- What:
--  1. gift_sync_appointment (phase69) treats a REFUNDED visit like a cancelled
--     one: the gift-card value it spent goes back on the card. Its trigger now
--     also fires on payment_status (mirrors phase73 for loyalty), so every refund
--     path is covered by the table itself. Only the difference is ever applied,
--     under a row lock — retries and double-fires are no-ops.
--  2. transactions.payment_method also allows 'gift_card' — the refund record of
--     the gift-card part of a visit ("$25 back on the gift card"). It moves no
--     money (the value was counted when the card was sold); it only takes back
--     the tax / tip that part covered, on the refund's day.
--  3. gift_refund_sale() — refund an unused gift card: in ONE locked step it
--     takes the card's remaining balance to $0, voids the card and writes the
--     ledger row (with the owner's reason). Returns the amount to hand back, so
--     two clicks can never refund the same balance twice. The app then returns
--     that money (Stripe, or recorded cash) and writes its refund record.
--
-- Additive; existing rows are untouched. Server-only functions.

create or replace function public.gift_sync_appointment(p_appointment_id uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_status text; v_pay text; v_shop uuid; v_card uuid; v_orig numeric; v_net numeric; v_target numeric; v_applied numeric;
begin
  select a.status, a.payment_status into v_status, v_pay from public.appointments a where a.id = p_appointment_id for update;
  if not found then return 0; end if;
  select l.shop_id, l.gift_card_id, -l.amount into v_shop, v_card, v_orig
  from public.gift_card_ledger l where l.appointment_id = p_appointment_id and l.action = 'redeemed';
  if not found then return 0; end if;   -- not paid by gift card
  select coalesce(sum(l.amount), 0) into v_net from public.gift_card_ledger l
  where l.appointment_id = p_appointment_id and l.action in ('redeemed', 'restored', 'reapplied');
  -- A no-show keeps the value (like a prepaid card payment); cancelled or refunded gives it back.
  v_target := case when v_status = 'cancelled' or v_pay = 'refunded' then 0 else -v_orig end;
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
            left('Gift card not synced for appointment ' || new.id || ' (status ' || new.status
                 || ', payment ' || coalesce(new.payment_status, '-') || '): ' || sqlerrm, 300),
            'gift_on_appointment_status', new.shop_id);
  end;
  return new;
end $$;

create or replace trigger trg_gift_on_appointment_status
  after update of status, payment_status on public.appointments
  for each row when (old.status is distinct from new.status or old.payment_status is distinct from new.payment_status)
  execute function public.gift_on_appointment_status();

alter table public.transactions drop constraint if exists transactions_payment_method_check;
alter table public.transactions add constraint transactions_payment_method_check
  check (payment_method = any (array['card', 'cash', 'online', 'gift_card'])) not valid;
alter table public.transactions validate constraint transactions_payment_method_check;

create or replace function public.gift_refund_sale(
  p_shop_id uuid, p_gift_card_id uuid, p_note text, p_user_id uuid
) returns table (refunded numeric, status text)
language plpgsql security definer set search_path = public as $$
declare v_bal numeric;
begin
  select round(coalesce(g.remaining_value, 0), 2) into v_bal
  from public.gift_cards g where g.id = p_gift_card_id and g.shop_id = p_shop_id for update;
  if not found then return query select 0::numeric, 'not_found'::text; return; end if;
  if v_bal <= 0 then return query select 0::numeric, 'empty'::text; return; end if;
  insert into public.gift_card_ledger (shop_id, gift_card_id, amount, action, note, created_by)
  values (p_shop_id, p_gift_card_id, -v_bal, 'refunded',
          coalesce(nullif(left(btrim(coalesce(p_note, '')), 200), ''), 'Gift card refunded'), p_user_id);
  update public.gift_cards set remaining_value = 0, is_active = false where id = p_gift_card_id;
  return query select v_bal, 'ok'::text;
end $$;

revoke all on function public.gift_refund_sale(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.gift_refund_sale(uuid, uuid, text, uuid) to service_role;

-- Already-refunded visits paid by gift card: give the value back now (idempotent).
select public.gift_sync_appointment(a.id)
from public.appointments a
where a.payment_status = 'refunded'
  and exists (select 1 from public.gift_card_ledger l where l.appointment_id = a.id and l.action = 'redeemed');

-- ROLLBACK:
-- re-run gift_sync_appointment / gift_on_appointment_status / the trigger from phase69 (status only);
-- drop function if exists public.gift_refund_sale(uuid, uuid, text, uuid);
-- (leave the payment_method CHECK widened while any 'gift_card' refund rows exist)
