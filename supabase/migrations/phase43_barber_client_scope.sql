-- phase43_barber_client_scope.sql
-- Tighten barber access to CLIENTS: a barber may read only the clients who have
-- actually booked with THEM (an appointment assigned to that barber) — not the
-- whole shop's customer list. Owners are unaffected (owner policies + the
-- service-role backend bypass this). Requires appointments.client_id (phase36,
-- already live in prod).
--
-- Replaces the old phase6 rule that let ANY active barber read EVERY client in
-- the shop. This matches the intended model: a barber sees the contacts booked
-- with them, and their own earnings/commission — nothing else.
--
-- Trade-off: a barber running POS for a brand-new walk-in won't find an existing
-- client who has only ever seen another barber. Acceptable per the shop's intent;
-- the owner/front-desk (owner policy) still sees everyone.

drop policy if exists "clients_barber_select" on public.clients;
create policy "clients_barber_select" on public.clients for select using (
  exists (
    select 1
    from public.appointments a
    join public.barbers b on b.id = a.barber_id
    where a.client_id = clients.id
      and b.user_id = auth.uid()
      and b.is_active = true
  )
);
