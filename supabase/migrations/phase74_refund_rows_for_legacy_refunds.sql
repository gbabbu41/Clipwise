-- phase74 — every refunded charge has its refund row (legacy refunds)
--
-- Why (owner rule 2026-10-02): revenue is now a statement, not a rewrite. A sale
-- counts on the day it was PAID even if refunded later, and the refund is its
-- own negative row (transactions source 'refund', lib/refund-ledger) on the day
-- the money went back. Refunds made before refund rows existed have no such
-- row, so their sale would suddenly count with nothing taken back.
--
-- What: for each refunded charge (by payment intent) with no refund row, add
-- one — dated at the SALE, because the real refund date was never recorded.
-- So those old days read as before (sale − refund = 0; only the card fee Stripe
-- kept stays visible as a cost). Amounts mirror what revenue counts for the
-- sale: the charge's ledger gross, with the booking's tax/tip split for an
-- appointment (the ledger's split for a no-show fee). The id is the same
-- deterministic id the app uses (refundRecordId), so a late webhook can never
-- add a second row. Idempotent: re-running adds nothing.
--
-- Data only; no schema change.

insert into public.transactions (
  id, shop_id, barber_id, client_name, service_name, amount, tip, tax,
  payment_method, type, source, appointment_id, payment_intent_id, refunded, stripe_fee, created_at
)
select
  (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-5' || substr(h, 14, 3) || '-'
   || to_hex(((('x' || lpad(substr(h, 17, 1), 8, '0'))::bit(32)::int) & 3) | 8)
   || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid,
  x.shop_id, x.barber_id, x.client_name,
  'Refund — ' || coalesce(nullif(x.service_name, ''), 'Payment') || ' (refund date not recorded; dated at sale)',
  -(x.gross - x.tax_part - x.tip_part), -x.tip_part, -x.tax_part,
  'card', 'service', 'refund', x.appointment_id, x.pi, true, 0, x.at
from (
  select
    t.payment_intent_id as pi, t.shop_id, t.barber_id, t.client_name, t.service_name, t.appointment_id,
    round(coalesce(t.amount, 0) + coalesce(t.tax, 0) + coalesce(t.tip, 0), 2) as gross,
    round(case when a.id is not null and coalesce(a.status, '') <> 'no-show' then coalesce(a.tax_amount, 0) else coalesce(t.tax, 0) end, 2) as tax_part,
    round(case when a.id is not null and coalesce(a.status, '') <> 'no-show' then coalesce(a.tip_amount, 0) else coalesce(t.tip, 0) end, 2) as tip_part,
    case when a.id is not null and coalesce(a.status, '') <> 'no-show' then coalesce(a.paid_at, t.created_at) else t.created_at end as at,
    encode(extensions.digest('clipwise-refund-ledger:' || t.payment_intent_id, 'sha256'), 'hex') as h,
    row_number() over (partition by t.payment_intent_id order by t.created_at) as rn
  from public.transactions t
  left join public.appointments a on a.payment_intent_id = t.payment_intent_id and a.shop_id = t.shop_id
  where t.refunded and coalesce(t.source, '') <> 'refund' and t.payment_intent_id is not null
    and not exists (select 1 from public.transactions r where r.source = 'refund' and r.payment_intent_id = t.payment_intent_id)
) x
where x.rn = 1 and x.gross > 0
on conflict (id) do nothing;

-- Verify: every refunded charge has exactly one refund row.
-- select count(*) from (select payment_intent_id from transactions where refunded and coalesce(source,'')<>'refund' and payment_intent_id is not null
--   except select payment_intent_id from transactions where source='refund') m;   -- expect 0
-- ROLLBACK:
-- delete from public.transactions where source = 'refund' and service_name like '%(refund date not recorded; dated at sale)';
