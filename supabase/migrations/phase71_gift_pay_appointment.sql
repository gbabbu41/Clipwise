-- phase71 — pay an appointment with a gift card at checkout
--
-- Why (2026-09-29): checkout offered cash / payment link / card on file, but no
-- way to take a gift card for a visit. The only "redeem" was a separate button on
-- the Gift Cards page that took money off a card with no link to the visit.
--
-- What: gift_pay_appointment() — ONE locked step that
--   * only pays a booking that is still open and unpaid (not cancelled / no-show,
--     not already paid, refunded, or holding a card),
--   * spends up to what's owed (service + tax + tip) from the card, linked to the
--     booking (phase69: cancelling it later gives the value back automatically),
--   * marks the booking paid by gift card, records how much the card covered
--     (gift_applied — not new money, it was counted when the card was sold), and
--     leaves any shortfall as balance_due for the normal "Balance to collect"
--     (cash / link / card on file),
--   * is safe to retry: a second call for the same booking never spends twice.
-- Completion (status → completed + its side effects) stays with the app's
-- existing completion path, exactly like cash.
--
-- Additive; server-only.

create or replace function public.gift_pay_appointment(
  p_shop_id uuid, p_appointment_id uuid, p_code text
) returns table (applied numeric, balance_due numeric, card_balance numeric, status text)
language plpgsql security definer set search_path = public as $$
declare v_status text; v_pay text; v_owed numeric; v_net numeric; v_card uuid; v_applied numeric; v_bal numeric; v_due numeric;
begin
  select a.status, a.payment_status, round(coalesce(a.total_amount, 0) + coalesce(a.tip_amount, 0), 2)
    into v_status, v_pay, v_owed
  from public.appointments a where a.id = p_appointment_id and a.shop_id = p_shop_id for update;
  if not found then return query select 0::numeric, null::numeric, null::numeric, 'not_found'::text; return; end if;
  if v_status in ('cancelled', 'no-show') then return query select 0::numeric, null::numeric, null::numeric, 'not_open'::text; return; end if;
  if v_pay in ('paid', 'captured', 'refunded', 'voided') then return query select 0::numeric, null::numeric, null::numeric, 'already_paid'::text; return; end if;
  if v_pay = 'held' then return query select 0::numeric, null::numeric, null::numeric, 'card_held'::text; return; end if;
  if v_owed <= 0 then return query select 0::numeric, null::numeric, null::numeric, 'nothing_due'::text; return; end if;

  -- A retry after a spend that already landed for this booking: finish, don't spend again.
  select coalesce(sum(l.amount), 0), max(l.gift_card_id::text)::uuid into v_net, v_card
  from public.gift_card_ledger l
  where l.appointment_id = p_appointment_id and l.action in ('redeemed', 'restored', 'reapplied');
  if v_net < 0 then
    v_applied := -v_net;
  else
    select g.id into v_card from public.gift_cards g
    where g.shop_id = p_shop_id and g.code = upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
    if not found then return query select 0::numeric, null::numeric, null::numeric, 'card_not_found'::text; return; end if;
    select -x.applied into v_applied
    from public.gift_adjust(p_shop_id, v_card, -v_owed, 'redeemed', p_appointment_id, false) x;
    if coalesce(v_applied, 0) <= 0 then return query select 0::numeric, null::numeric, null::numeric, 'card_empty'::text; return; end if;
  end if;

  v_due := greatest(round(v_owed - v_applied, 2), 0);
  update public.appointments set
    payment_status = 'paid', payment_method = 'gift_card', paid_at = now(),
    gift_applied = v_applied, balance_due = v_due
  where id = p_appointment_id;
  select round(coalesce(g.remaining_value, 0), 2) into v_bal from public.gift_cards g where g.id = v_card;
  return query select v_applied, v_due, v_bal, 'ok'::text;
end $$;

revoke all on function public.gift_pay_appointment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.gift_pay_appointment(uuid, uuid, text) to service_role;

-- ROLLBACK:
-- drop function if exists public.gift_pay_appointment(uuid, uuid, text);
