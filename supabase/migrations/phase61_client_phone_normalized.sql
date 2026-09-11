-- Normalized phone on clients (digits only, last 10) — a GENERATED column, so it's
-- always in sync and computed for existing rows too. Indexed for fast lookup.
--
-- IMPORTANT: this is NOT wired into client IDENTITY/de-dup. The live data showed
-- that different people share a phone (e.g. a customer and a family member), so
-- merging clients by phone would wrongly combine distinct people — the owner
-- declined phone-as-identity. This column exists for PER-NUMBER matching that is
-- legitimately phone-scoped (e.g. an SMS STOP opt-out applies to the whole
-- number, whoever texted it), not for deciding who is the same client.
alter table public.clients
  add column if not exists phone_normalized text
  generated always as (nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')) stored;

create index if not exists clients_shop_phone_norm_idx
  on public.clients (shop_id, phone_normalized);

-- One-time cleanup: deleted the clear test duplicate "Test singh Gill"
-- (id e4f1d60c-6c9f-4888-af6a-a16cd893d01d) in the test shop "Singh Cut".
-- Its one appointment unlinks via the ON DELETE SET NULL FK.
