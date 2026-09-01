-- phase57 — Plan-gate the inventory table (Premium feature).
--
-- Inventory writes go straight through the browser (no API route), gated only by
-- an owner-based RLS policy with NO plan check — so a Pro/Starter owner going
-- around the (client-only) feature lock could read/write inventory. Tighten the
-- policy so only a shop whose ACTIVE plan includes the 'inventory' feature (per the
-- admin-editable plans table) can touch its inventory. Plan-table-driven, so it
-- follows future feature edits automatically (no hardcoded plan names).
--
-- Service-role writes (the POS inventory drawdown in cash-sale / pos-finalize)
-- BYPASS RLS, so this does not affect them.

drop policy if exists inventory_manage_owner on public.inventory;
create policy inventory_manage_owner on public.inventory
  for all
  using (
    exists (
      select 1
      from public.shops s
      join public.plans p on p.id = s.subscription_plan
      where s.id = inventory.shop_id
        and s.owner_id = auth.uid()
        and s.subscription_status = 'active'
        and 'inventory' = any(p.features)
    )
    or public.is_super_admin()
  );
