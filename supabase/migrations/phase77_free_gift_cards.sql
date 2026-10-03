-- phase77 — free (complimentary) gift cards are a 100% promo; every gift path pays
-- the barber the same way
--
-- Why (owner decision 2026-10-03): a gift card the shop GAVE AWAY brought in no
-- money, so a visit paid with it must count $0 income, $0 tax, $0 tip and pay no
-- commission — exactly like a 100% promo / loyalty discount. A PAID gift card
-- stays as it is (income when sold; tax + barber % when used). And a gift card
-- applied to an ONLINE booking (the rest charged by card) never got the barber's
-- gift-part earnings line, because that booking is inserted already paid.
--
-- What:
--  1. gift_cards.complimentary — true for a card the shop gave away (the app sets
--     it; existing "Complimentary…" cards backfilled).
--  2. appointments.gift_free — how much of the visit a FREE card covered (0 for a
--     paid card). The app subtracts its share of service / tax / tip everywhere
--     (lib/revenue freeGiftShare) — same proportional split as below.
--  3. gift_earning_sync (phase76) now: sets gift_free; writes the barber's
--     earnings line ONLY for a paid card; a free card gets none (and so no
--     take-back on cancel/refund).
--  4. A trigger on gift_card_ledger runs it the moment a card is spent on a
--     booking — so every path (checkout, prepaid booking, ONLINE booking + card)
--     is covered, not only status changes.
--  5. Cleanup: earnings / take-back lines phase76 wrote for visits paid with a
--     free card are removed (written today, never part of a closed pay period).
--
-- Additive; server-only.

alter table public.gift_cards add column if not exists complimentary boolean not null default false;
update public.gift_cards set complimentary = true where not complimentary and note ilike 'complimentary%';

alter table public.appointments add column if not exists gift_free numeric(10,2) not null default 0;

create or replace function public.gift_earning_sync(p_appointment_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare a record; e record; v_g numeric; v_card uuid; v_free boolean; v_base numeric; v_tax numeric; v_tip numeric; v_n integer := 0;
        v_earn uuid := public.clipwise_ledger_id('gift-earning:' || p_appointment_id);
        v_back uuid := public.clipwise_ledger_id('gift:' || p_appointment_id);
begin
  select ap.id, ap.shop_id, ap.barber_id, ap.client_name, ap.status, ap.payment_status, ap.paid_at,
         ap.total_amount, ap.tax_amount, ap.tip_amount, ap.gift_free, s.name as svc
    into a
  from public.appointments ap left join public.services s on s.id = ap.service_id
  where ap.id = p_appointment_id;
  if not found then return 0; end if;
  -- The gift value this visit spent (its one 'redeemed' row) and which card.
  select -l.amount, l.gift_card_id into v_g, v_card from public.gift_card_ledger l
  where l.appointment_id = p_appointment_id and l.action = 'redeemed';
  if not found or coalesce(v_g, 0) <= 0 then return 0; end if;
  select coalesce(g.complimentary, false) into v_free from public.gift_cards g where g.id = v_card;

  -- A free card: a 100% promo — record how much it covered; nothing for the barber.
  if coalesce(v_free, false) then
    if coalesce(a.gift_free, 0) <> v_g then
      update public.appointments set gift_free = v_g where id = p_appointment_id;
      v_n := v_n + 1;
    end if;
    return v_n;
  end if;

  -- 1. Paid by a (paid) gift card → the barber's earnings line (its share of tax + tip).
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

revoke all on function public.gift_earning_sync(uuid) from public, anon, authenticated;
grant execute on function public.gift_earning_sync(uuid) to service_role;

-- Run it the moment a card is spent on a booking (covers an ONLINE booking that is
-- inserted already paid, then has its gift card drawn down).
create or replace function public.gift_on_ledger_redeemed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.gift_earning_sync(new.appointment_id);
  exception when others then
    insert into public.error_logs (level, source, message, path, shop_id)
    values ('error', 'gift-earning',
            left('Gift-card earnings line not synced for appointment ' || new.appointment_id || ': ' || sqlerrm, 300),
            'gift_on_ledger_redeemed', new.shop_id);
  end;
  return new;
end $$;

drop trigger if exists trg_gift_on_ledger_redeemed on public.gift_card_ledger;
create trigger trg_gift_on_ledger_redeemed
  after insert on public.gift_card_ledger
  for each row when (new.action = 'redeemed' and new.appointment_id is not null)
  execute function public.gift_on_ledger_redeemed();

revoke all on function public.gift_on_ledger_redeemed() from public, anon, authenticated;

-- Cleanup: lines phase76 wrote for visits paid with a FREE card (a promo pays no one).
delete from public.transactions t
using public.gift_card_ledger l join public.gift_cards g on g.id = l.gift_card_id
where l.action = 'redeemed' and l.appointment_id is not null and g.complimentary
  and t.id in (public.clipwise_ledger_id('gift-earning:' || l.appointment_id),
               public.clipwise_ledger_id('gift:' || l.appointment_id));

-- Every gift-card visit: sync now (sets gift_free for free cards; lines for paid ones).
select public.gift_earning_sync(a.id)
from public.appointments a
where exists (select 1 from public.gift_card_ledger l where l.appointment_id = a.id and l.action = 'redeemed');

-- ROLLBACK:
-- drop trigger if exists trg_gift_on_ledger_redeemed on public.gift_card_ledger;
-- drop function if exists public.gift_on_ledger_redeemed();
-- re-run gift_earning_sync from phase76; the two columns can stay (harmless).
