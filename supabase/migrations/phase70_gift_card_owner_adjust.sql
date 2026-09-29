-- phase70 — owner corrections to a gift card go through the ledger, with a reason
--
-- Why (2026-09-29): the Gift Cards page "Redeem" button changed a card's balance
-- straight from the browser (read balance → subtract → write back). Two tabs could
-- both spend the same money, the change left no history, and nothing said why.
-- "Void" was the same kind of direct browser write.
--
-- What:
--  1. gift_card_ledger gets `note` (the owner's reason) + `created_by` (who).
--  2. gift_adjust_manual() — the owner's balance correction. Locks the card, never
--     takes more than the balance (all-or-nothing), never adds above the card's
--     original value, refuses a voided card, and writes balance + ledger row
--     (with the reason) together. Returns a status the app can explain.
--  3. gift_set_active() — void / reactivate, also locked + recorded with a reason
--     (a zero-amount ledger row, so balance == value + sum(ledger) still holds).
--  4. The browser can no longer write gift_cards at all (reads stay as they are):
--     every change goes through a server route and these functions.
--
-- Additive; existing cards, balances and history are unchanged. Server-only.

alter table public.gift_card_ledger add column if not exists note text;
alter table public.gift_card_ledger add column if not exists created_by uuid;

create or replace function public.gift_adjust_manual(
  p_shop_id uuid, p_gift_card_id uuid, p_delta numeric, p_note text, p_user_id uuid
) returns table (applied numeric, balance numeric, status text)
language plpgsql security definer set search_path = public as $$
declare v_bal numeric; v_init numeric; v_active boolean; v_delta numeric := round(coalesce(p_delta, 0), 2);
        v_applied numeric; v_new numeric;
begin
  if coalesce(btrim(p_note), '') = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  select round(coalesce(g.remaining_value, 0), 2), round(coalesce(g.initial_value, 0), 2), coalesce(g.is_active, false)
    into v_bal, v_init, v_active
  from public.gift_cards g where g.id = p_gift_card_id and g.shop_id = p_shop_id for update;
  if not found then return query select 0::numeric, null::numeric, 'not_found'::text; return; end if;
  if v_delta = 0 then return query select 0::numeric, v_bal, 'no_change'::text; return; end if;
  if not v_active and v_bal > 0 then return query select 0::numeric, v_bal, 'void'::text; return; end if;
  if v_delta < 0 and v_bal < -v_delta then return query select 0::numeric, v_bal, 'insufficient'::text; return; end if;
  if v_delta > 0 and v_bal + v_delta > v_init then return query select 0::numeric, v_bal, 'above_value'::text; return; end if;

  select a.applied, a.balance into v_applied, v_new
  from public.gift_adjust(p_shop_id, p_gift_card_id, v_delta, 'adjusted', null, true) a;
  if coalesce(v_applied, 0) = 0 then return query select 0::numeric, v_bal, 'no_change'::text; return; end if;
  -- The card row is still locked by this transaction, so the row gift_adjust just
  -- wrote is the only 'adjusted' row for this card stamped with this transaction's time.
  update public.gift_card_ledger l set note = left(btrim(p_note), 200), created_by = p_user_id
  where l.id = (select x.id from public.gift_card_ledger x
                where x.gift_card_id = p_gift_card_id and x.action = 'adjusted' and x.note is null and x.created_at = now()
                limit 1);
  return query select v_applied, v_new, 'ok'::text;
end $$;

create or replace function public.gift_set_active(
  p_shop_id uuid, p_gift_card_id uuid, p_active boolean, p_note text, p_user_id uuid
) returns text
language plpgsql security definer set search_path = public as $$
declare v_bal numeric; v_active boolean;
begin
  select round(coalesce(g.remaining_value, 0), 2), coalesce(g.is_active, false) into v_bal, v_active
  from public.gift_cards g where g.id = p_gift_card_id and g.shop_id = p_shop_id for update;
  if not found then return 'not_found'; end if;
  if v_active = p_active then return 'no_change'; end if;
  if p_active and v_bal <= 0 then return 'empty'; end if;   -- nothing to reactivate
  update public.gift_cards set is_active = p_active where id = p_gift_card_id;
  insert into public.gift_card_ledger (shop_id, gift_card_id, amount, action, note, created_by)
  values (p_shop_id, p_gift_card_id, 0, case when p_active then 'reactivated' else 'voided' end,
          nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_user_id);
  return 'ok';
end $$;

revoke all on function public.gift_adjust_manual(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.gift_set_active(uuid, uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.gift_adjust_manual(uuid, uuid, numeric, text, uuid) to service_role;
grant execute on function public.gift_set_active(uuid, uuid, boolean, text, uuid) to service_role;

-- A card balance is stored money: the browser reads cards (owner RLS) but never writes them.
revoke insert, update, delete on public.gift_cards from anon, authenticated;

-- ROLLBACK:
-- grant insert, update, delete on public.gift_cards to authenticated;
-- drop function if exists public.gift_adjust_manual(uuid, uuid, numeric, text, uuid),
--   public.gift_set_active(uuid, uuid, boolean, text, uuid);
-- (the note / created_by columns can stay — harmless)
