-- Phase 7: POS idempotency — prevent double-charge on double-submit
-- Add stripe_session_id to transactions with a unique constraint
alter table public.transactions add column if not exists stripe_session_id text;
create unique index if not exists transactions_stripe_session_id_unique
  on public.transactions (stripe_session_id)
  where stripe_session_id is not null;
