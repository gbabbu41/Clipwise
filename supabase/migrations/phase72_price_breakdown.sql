-- phase72 — remember HOW a price was reached (promo / loyalty points)
--
-- Why (2026-09-30 smoke test): a Skin Fade ($35) paid with 423 loyalty points
-- came to $15.93, but no screen, alert, transaction or email said points were
-- used or how much — only the final amount was stored, so nothing could show it.
-- Promo-code discounts had the same gap.
--
-- What: price_breakdown jsonb on appointments + transactions, written when the
-- booking / sale is made:
--   { subtotal, promo_code, promo_discount, loyalty_points, loyalty_discount }
-- (keys present only when they apply). Display-only — totals, tax, revenue and
-- commission keep using the existing columns, so no money logic changes.
-- Backfill: bookings that already redeemed points (loyalty_rewards ledger) get
-- their points + dollar value at the shop's current rate.
--
-- Additive.

alter table public.appointments add column if not exists price_breakdown jsonb;
alter table public.transactions add column if not exists price_breakdown jsonb;

update public.appointments a
set price_breakdown = jsonb_build_object(
  'loyalty_points', r.pts,
  'loyalty_discount', round(r.pts * coalesce((s.booking_settings->'loyalty'->>'redemption_rate')::numeric, 5) / 100, 2)
)
from (
  select appointment_id, -sum(points)::int as pts
  from public.loyalty_rewards
  where action = 'redeemed' and appointment_id is not null
  group by appointment_id
) r, public.shops s
where a.id = r.appointment_id and s.id = a.shop_id and a.price_breakdown is null and r.pts > 0;

-- ROLLBACK:
-- alter table public.appointments drop column if exists price_breakdown;
-- alter table public.transactions drop column if exists price_breakdown;
