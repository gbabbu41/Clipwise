-- ============================================================
-- Phase 14: combined-duration for multi-service appointments
-- ============================================================
-- A "haircut (30) + beard (20)" booking used to create TWO appointment rows
-- at back-to-back slots. It now creates ONE appointment whose real length is
-- the SUM of the picked services. Since a row only links one service_id, we
-- store the authoritative block length in `duration_minutes` (the primary
-- service is kept as service_id; the full list is recorded in notes).
--
-- When NULL, callers fall back to services.duration_minutes (so every existing
-- single-service row keeps working unchanged). Idempotent.
-- ============================================================
alter table public.appointments
  add column if not exists duration_minutes integer;
