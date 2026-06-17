-- ============================================================
-- Phase 15: transaction provenance — appointment_id + source
-- ============================================================
-- The Payments feed used to de-dup an appointment's card charge from its
-- `transactions` row by matching `client_name | amount` — a heuristic that can
-- mis-merge two same-name/same-price rows or a coincidental POS sale. These two
-- columns let the de-dup key off real provenance instead.
--
--   source: 'pos' | 'completion' | 'no_show'  (NULL on pre-migration rows)
--     - 'pos'        : a Point-of-Sale sale (cash or Stripe Checkout card)
--     - 'completion' : appointment marked Complete → card captured for the total
--     - 'no_show'    : no-show fee charged on a held/saved card
--   appointment_id: the appointment this charge belongs to (NULL for POS sales)
--
-- Both nullable + additive, so existing rows and the existing heuristic keep
-- working unchanged (the read path falls back to the heuristic when source is
-- NULL). Idempotent.
-- ============================================================
alter table public.transactions
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

alter table public.transactions
  add column if not exists source text;

-- Speeds up "does this appointment already have a charge row?" lookups.
create index if not exists transactions_appointment_id_idx
  on public.transactions (appointment_id);
