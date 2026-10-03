-- phase77 — a no-show pays the barber nothing; the shop keeps the money
--
-- Why (owner decision 2026-10-03): a booking paid IN ADVANCE (card online, gift
-- card, cash) that no-shows: the shop keeps the money and the barber earns no
-- commission — the same rule as a no-show fee. The shop's Payroll / Dashboard
-- already paid no commission on no-shows, but the barber's own earnings still
-- showed the cut from the booking's earnings line (written when it was paid).
--
-- What: the moment a booking is marked no-show, its earnings line(s)
-- (transactions source 'completion' for that booking) are tagged "(no-show)" —
-- the app's one no-show rule (lib/barber-earnings isNoShowEarning) then leaves
-- them out of every barber view and takes no commission back on a refund. The
-- money itself is untouched (still counted for the shop). Undoing the no-show
-- removes the tag. A gift-card take-back line written for a no-show visit
-- (phase76) carries the tag too. Runs from the appointments trigger, so every
-- path (calendar, appointments page, server routes, future code) is covered.
--
-- Additive; only the label of those lines changes. Server-only.

create or replace function public.no_show_earnings_sync()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.status = 'no-show' then
      update public.transactions
        set service_name = coalesce(nullif(service_name, ''), 'Service') || ' (no-show)'
      where appointment_id = new.id and source = 'completion'
        and coalesce(service_name, '') not ilike '%no-show%';
    elsif old.status = 'no-show' then
      update public.transactions
        set service_name = regexp_replace(service_name, '\s*\(no-show\)$', '')
      where appointment_id = new.id and source = 'completion'
        and service_name ilike '%(no-show)';
    end if;
  exception when others then
    insert into public.error_logs (level, source, message, path, shop_id)
    values ('error', 'no-show-earnings',
            left('No-show earnings tag not synced for appointment ' || new.id || ': ' || sqlerrm, 300),
            'no_show_earnings_sync', new.shop_id);
  end;
  return new;
end $$;

drop trigger if exists trg_no_show_earnings on public.appointments;
create trigger trg_no_show_earnings
  after update of status on public.appointments
  for each row when (old.status is distinct from new.status and (new.status = 'no-show' or old.status = 'no-show'))
  execute function public.no_show_earnings_sync();

revoke all on function public.no_show_earnings_sync() from public, anon, authenticated;

-- A gift-card take-back line (phase76) for a no-show visit: tagged the same way.
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
  select -l.amount into v_g from public.gift_card_ledger l
  where l.appointment_id = p_appointment_id and l.action = 'redeemed';
  if not found or coalesce(v_g, 0) <= 0 then return 0; end if;

  if a.payment_status in ('paid', 'captured', 'refunded')
     and not exists (select 1 from public.transactions where id = v_earn) then
    v_base := coalesce(a.total_amount, 0) + coalesce(a.tip_amount, 0);
    v_tax := case when v_base > 0 then round(v_g * coalesce(a.tax_amount, 0) / v_base, 2) else 0 end;
    v_tip := case when v_base > 0 then round(v_g * coalesce(a.tip_amount, 0) / v_base, 2) else 0 end;
    v_tax := least(greatest(v_tax, 0), v_g);
    v_tip := least(greatest(v_tip, 0), v_g - v_tax);
    insert into public.transactions (id, shop_id, barber_id, appointment_id, client_name, service_name,
      amount, tax, tip, stripe_fee, payment_method, type, source, refunded, created_at)
    values (v_earn, a.shop_id, a.barber_id, a.id, a.client_name,
      coalesce(a.svc, 'Service') || case when a.status = 'no-show' then ' (no-show)' else '' end,
      v_g - v_tax - v_tip, v_tax, v_tip, 0, 'gift_card', 'service', 'completion', false, coalesce(a.paid_at, now()))
    on conflict (id) do nothing;
    v_n := v_n + 1;
  end if;

  if (a.status = 'cancelled' or a.payment_status = 'refunded')
     and not exists (select 1 from public.transactions where id = v_back) then
    select * into e from public.transactions where id = v_earn;
    if found then
      insert into public.transactions (id, shop_id, barber_id, appointment_id, client_name, service_name,
        amount, tax, tip, stripe_fee, payment_method, type, source, refunded)
      values (v_back, e.shop_id, e.barber_id, e.appointment_id, e.client_name,
        'Refund — ' || coalesce(a.svc, 'Payment') || ' (back on gift card)'
          || case when a.status = 'no-show' then ' (no-show)' else '' end,
        -e.amount, -e.tax, -e.tip, 0, 'gift_card', 'service', 'refund', true)
      on conflict (id) do nothing;
      update public.transactions set refunded = true where id = v_earn and not refunded;
      v_n := v_n + 1;
    end if;
  end if;
  return v_n;
end $$;

revoke all on function public.gift_earning_sync(uuid) from public, anon, authenticated;
grant execute on function public.gift_earning_sync(uuid) to service_role;

-- Existing no-shows: tag their earnings lines now (idempotent).
update public.transactions t
  set service_name = coalesce(nullif(t.service_name, ''), 'Service') || ' (no-show)'
from public.appointments a
where a.id = t.appointment_id and a.status = 'no-show' and t.source = 'completion'
  and coalesce(t.service_name, '') not ilike '%no-show%';

-- ROLLBACK:
-- drop trigger if exists trg_no_show_earnings on public.appointments;
-- drop function if exists public.no_show_earnings_sync();
-- update public.transactions set service_name = regexp_replace(service_name, '\s*\(no-show\)$', '')
--   where source = 'completion' and service_name ilike '%(no-show)';
-- (and re-run gift_earning_sync from phase76)
