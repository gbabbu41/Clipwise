-- ============================================================
-- Phase 6: Barber read access to clients + transactions
-- Barbers need to look up clients for POS and appointment context.
-- They can SELECT (not modify) clients in their own shop only.
-- ============================================================

-- Allow barbers to read clients in their shop (for POS client lookup, appointment context)
drop policy if exists "clients_barber_select" on public.clients;
create policy "clients_barber_select" on public.clients for select using (
  exists(
    select 1 from public.barbers
    where barbers.shop_id = clients.shop_id
      and barbers.user_id = auth.uid()
      and barbers.is_active = true
  )
);

-- Allow barbers to read their own transactions only
drop policy if exists "transactions_barber_select" on public.transactions;
create policy "transactions_barber_select" on public.transactions for select using (
  exists(
    select 1 from public.barbers
    where barbers.id = transactions.barber_id
      and barbers.user_id = auth.uid()
  )
);
