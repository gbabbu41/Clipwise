-- phase76 — barbers earn on gift-card visits (and give it back on a refund)
--
-- Why (owner decision 2026-10-03): a visit paid by gift card wrote no earnings
-- line for the barber, so the barber's own earnings screen left it out while the
-- shop's Payroll / Dashboard commission counted it. The barber did the cut; the
-- gift card is real money the shop already collected when it was SOLD.
--
-- What: gift_earning_sync(appointment) — run by the appointments trigger (every
-- path: calendar / appointments-page checkout, booking prepaid by gift card,
-- refunds, cancels, future code), so nothing per-route can miss it:
--  1. PAID by gift card → ONE earnings line for the barber (transactions source
--     'completion', payment_method 'gift_card'), the gift part's service / tax /
--     tip — exactly like a card visit's line at capture. It moves NO money: the
--     app never counts a gift_card completion line as income (lib/revenue).
--  2. CANCELLED or REFUNDED (the gift value went back on the card — phase69/75)
--     → ONE take-back line (source 'refund', payment_method 'gift_card') on that
--     day: the barber's cut + tip come back off, the tax given back is recorded.
--     It uses the same id the app's refund engine uses for a gift part
--     (refundRecordId('gift:<booking>')), so the two can never both write one.
--  A no-show keeps the gift value, so it keeps its line (same as a prepaid card).
--  Ids are deterministic → retries / double-fires are no-ops. Never blocks the
--  status change: failures go to error_logs.
--
-- Additive; existing rows untouched. Server-only. Backfills existing gift visits.

-- The app's refundRecordId() (lib/refund-ledger) in SQL: same hash, same uuid shape.
create or replace function public.clipwise_ledger_id(p_key text) returns uuid
language sql immutable as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-5' || substr(h, 14, 3) || '-'
          || to_hex(((('x' || lpad(substr(h, 17, 1), 8, '0'))::bit(32)::int) & 3) | 8)
          || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select encode(sha256(convert_to('clipwise-refund-ledger:' || p_key, 'UTF8')), 'hex') as h) x
$$;

create or replace function public.gift_earning_sync(p_appointment_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare a record; e record; v_g numeric; v_base numeric; v_tax numeric; v_tip numeric; v_n integer := 0;
        v_earn uuid := public.clipwise_ledger_id('gift-earning:' || p_appointment_id);
        v_back uuid := public.clipwise_ledger_id('gift:' || p_appointment_id);
begin
  select ap.id, ap.shop_id, ap.barber_id, ap.client_name, ap.status, ap.payment_status, ap.paid_at,
         ap.total_amount, ap.tax_amount, ap.tip_amount, s.name as svc
    into a
  from public.appointments ap left join public.services s on s.id = ap.service_id
  where ap.id = p_appointment_id;
  if not found then return 0; end if;
  -- The gift value this visit spent (its one 'redeemed' row).
  select -l.amount into v_g from public.gift_card_ledger l
  where l.appointment_id = p_appointment_id and l.action = 'redeemed';
  if not found or coalesce(v_g, 0) <= 0 then return 0; end if;

  -- 1. Paid by gift card → the barber's earnings line (its share of tax + tip).
  if a.payment_status in ('paid', 'captured', 'refunded')
     and not exists (select 1 from public.transactions where id = v_earn) then
    v_base := coalesce(a.total_amount, 0) + coalesce(a.tip_amount, 0);
    v_tax := case when v_base > 0 then round(v_g * coalesce(a.tax_amount, 0) / v_base, 2) else 0 end;
    v_tip := case when v_base > 0 then round(v_g * coalesce(a.tip_amount, 0) / v_base, 2) else 0 end;
    v_tax := least(greatest(v_tax, 0), v_g);
    v_tip := least(greatest(v_tip, 0), v_g - v_tax);
    insert into public.transactions (id, shop_id, barber_id, appointment_id, client_name, service_name,
      amount, tax, tip, stripe_fee, payment_method, type, source, refunded, created_at)
    values (v_earn, a.shop_id, a.barber_id, a.id, a.client_name, coalesce(a.svc, 'Service'),
      v_g - v_tax - v_tip, v_tax, v_tip, 0, 'gift_card', 'service', 'completion', false, coalesce(a.paid_at, now()))
    on conflict (id) do nothing;
    v_n := v_n + 1;
  end if;

  -- 2. Cancelled / refunded → the gift value went back on the card: take the line back, once.
  if (a.status = 'cancelled' or a.payment_status = 'refunded')
     and not exists (select 1 from public.transactions where id = v_back) then
    select * into e from public.transactions where id = v_earn;
    if found then
      insert into public.transactions (id, shop_id, barber_id, appointment_id, client_name, service_name,
        amount, tax, tip, stripe_fee, payment_method, type, source, refunded)
      values (v_back, e.shop_id, e.barber_id, e.appointment_id, e.client_name,
        'Refund — ' || coalesce(a.svc, 'Payment') || ' (back on gift card)',
        -e.amount, -e.tax, -e.tip, 0, 'gift_card', 'service', 'refund', true)
      on conflict (id) do nothing;
      update public.transactions set refunded = true where id = v_earn and not refunded;
      v_n := v_n + 1;
    end if;
  end if;
  return v_n;
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
  begin
    perform public.gift_earning_sync(new.id);
  exception when others then
    insert into public.error_logs (level, source, message, path, shop_id)
    values ('error', 'gift-earning',
            left('Gift-card earnings line not synced for appointment ' || new.id || ' (status ' || new.status
                 || ', payment ' || coalesce(new.payment_status, '-') || '): ' || sqlerrm, 300),
            'gift_on_appointment_status', new.shop_id);
  end;
  return new;
end $$;

revoke all on function public.gift_earning_sync(uuid) from public, anon, authenticated;
revoke all on function public.clipwise_ledger_id(text) from public, anon, authenticated;
grant execute on function public.gift_earning_sync(uuid) to service_role;

-- Existing gift-card visits: write their lines now (idempotent).
select public.gift_earning_sync(a.id)
from public.appointments a
where exists (select 1 from public.gift_card_ledger l where l.appointment_id = a.id and l.action = 'redeemed');

-- ROLLBACK:
-- re-run gift_on_appointment_status from phase75; drop function public.gift_earning_sync(uuid);
-- delete from public.transactions where payment_method = 'gift_card'
--   and id = public.clipwise_ledger_id('gift-earning:' || appointment_id);   -- earnings lines
-- (take-back lines share the refund engine's id; remove only if no app refund wrote it)
-- drop function public.clipwise_ledger_id(text);
