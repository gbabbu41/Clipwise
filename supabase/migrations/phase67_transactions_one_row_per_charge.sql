-- phase67 — one ledger row per Stripe charge
--
-- REQUIRED (owner runs manually in the Supabase SQL editor). Run each step on its
-- own — CREATE/DROP INDEX CONCURRENTLY cannot run inside a transaction block.
--
-- Why: every card writer (online booking/tip, capture, balance link, collect
-- balance, POS Checkout, Terminal) already checks "is this payment id recorded?"
-- before inserting, but two saves of the SAME charge at the same moment (webhook
-- retry vs. customer return, a double tap) can both pass that check and write
-- two rows = double revenue/commission. This rule lets the database accept
-- exactly one; the app turns the loser's conflict into the verified existing row.
--
-- Scope: one row per payment_intent_id across ALL shops (a Stripe charge belongs
-- to exactly one shop). Excluded: rows with no payment id (cash, gift-card sales,
-- legacy rows) and source = 'refund' audit rows, which intentionally reuse the
-- original charge's payment id. Tips and balances are their own Stripe charges
-- (own payment ids), so they are covered without conflicting with the booking.
-- Checkout sessions are already unique (transactions_stripe_session_id_unique).

-- 1. Pre-check — must return ZERO rows (prod on 2026-09-28: zero). If any rows
--    come back, STOP: the index would not build; nothing is changed.
select payment_intent_id, count(*) as rows, count(distinct shop_id) as shops
from public.transactions
where payment_intent_id is not null and source is distinct from 'refund'
group by payment_intent_id
having count(*) > 1;

-- 2. Create the rule without blocking reads/writes (small table; seconds).
create unique index concurrently if not exists transactions_one_row_per_charge
  on public.transactions (payment_intent_id)
  where payment_intent_id is not null and source is distinct from 'refund';

-- 3. Verify — must return one row with indisvalid = true. If false (the build was
--    interrupted), run the rollback below and repeat steps 1–2.
select c.relname, i.indisvalid, i.indisunique, pg_get_indexdef(i.indexrelid)
from pg_index i join pg_class c on c.oid = i.indexrelid
where c.relname = 'transactions_one_row_per_charge';

-- ROLLBACK (removes only this rule; no data is touched; the app keeps working —
-- it simply falls back to its existing check-before-insert):
-- drop index concurrently if exists public.transactions_one_row_per_charge;
