-- ============================================================
-- Phase 9: Admin-editable pricing plans
-- A single source of truth for subscription tiers. Replaces the
-- previously-hardcoded prices that lived (inconsistently) in
-- src/lib/stripe.ts, onboarding/plan, admin/settings, admin/page.
--
-- The super_admin (gbabbu41) edits these rows from /admin/settings.
-- Prices flow straight into Stripe Checkout (dynamic price_data, so no
-- Stripe Price objects to manage) and the `features` array drives what
-- each plan can actually do in the app (payments, loyalty, pos, ...).
--
-- price_cents : monthly price in cents, CAD. 0 = free.
-- barber_limit: max barbers; NULL = unlimited.
-- features    : gated capability flags (security boundary). Allowed values:
--               payments | loyalty | pos | inventory | staff_portal | commission
-- highlights  : marketing bullet points shown on the pricing cards.
-- ============================================================

create table if not exists public.plans (
  id           text primary key,                       -- slug: starter|pro|premium|business|...
  name         text not null,
  price_cents  integer not null default 0 check (price_cents >= 0),
  barber_limit integer check (barber_limit is null or barber_limit >= 1),
  features     text[] not null default '{}',
  highlights   text[] not null default '{}',
  badge        text,
  description  text,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- keep updated_at fresh on edit
create or replace function public.set_plans_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists plans_updated_at on public.plans;
create trigger plans_updated_at
  before update on public.plans
  for each row execute function public.set_plans_updated_at();

-- ── RLS: anyone may read ACTIVE plans (pricing page is public);
--        only the super_admin may create / edit / delete. ────────────────────
alter table public.plans enable row level security;

drop policy if exists "plans_select_active" on public.plans;
create policy "plans_select_active" on public.plans
  for select using (is_active = true or public.is_super_admin());

drop policy if exists "plans_insert_admin" on public.plans;
create policy "plans_insert_admin" on public.plans
  for insert with check (public.is_super_admin());

drop policy if exists "plans_update_admin" on public.plans;
create policy "plans_update_admin" on public.plans
  for update using (public.is_super_admin());

drop policy if exists "plans_delete_admin" on public.plans;
create policy "plans_delete_admin" on public.plans
  for delete using (public.is_super_admin());

-- ── Seed the current real tiers. ON CONFLICT DO NOTHING so re-running this
--    migration never clobbers prices the admin has since edited. ────────────
insert into public.plans (id, name, price_cents, barber_limit, features, highlights, badge, description, is_active, sort_order) values
  ('starter', 'Starter', 0, 1, '{}',
   '{"1 barber","Online booking page","Appointment management","SMS reminders","Basic analytics"}',
   null, 'Free forever — get online and take bookings.', true, 0),
  ('pro', 'Pro', 2300, 4, '{payments,loyalty}',
   '{"Up to 4 barbers","Online booking + customer payments","Loyalty program","Advanced analytics","Stripe Connect for payouts","Instant approval"}',
   'Most Popular', 'Everything you need to take payments and grow.', true, 1),
  ('premium', 'Premium', 4900, 9, '{payments,loyalty,pos,inventory,staff_portal,commission}',
   '{"Up to 9 barbers","Everything in Pro","Full POS","Inventory management","Staff management & payroll","Full analytics & reports","Dedicated support"}',
   'Full Suite', 'The complete shop-management suite.', true, 2),
  ('business', 'Business', 19900, null, '{payments,loyalty,pos,inventory,staff_portal,commission}',
   '{"Unlimited barbers","Everything in Premium","Multi-location ready","Priority support"}',
   null, 'For multi-location operators. Contact us to enable.', false, 3)
on conflict (id) do nothing;

-- Let shops reference any plan id so the admin can add tiers beyond the
-- original four. The plan a shop is on is still set server-side (checkout /
-- webhook) and guarded by prevent_shop_field_escalation, so dropping this
-- hardcoded CHECK does not let an owner self-upgrade.
alter table public.shops drop constraint if exists shops_subscription_plan_check;

