-- phase45_input_length_limits.sql
-- Defense-in-depth: cap free-text columns at the DATABASE level so NO write path
-- (the public/anon booking form, a direct API call, the Supabase console, a
-- future bug) can bloat the DB with a giant payload — e.g. someone POSTing
-- megabytes/"millions of characters" of text.
--
-- NOTE: this is NOT about SQL injection. Supabase/PostgREST send every value as a
-- bound parameter, never concatenated into SQL, so a "'; DROP TABLE …" typed into
-- a field is stored as harmless literal text. This migration bounds LENGTH only —
-- the real abuse/DoS vector for an app where anyone can sign up with just an email.
--
-- The app already caps these in the UI + server routes; these constraints are the
-- last-line backstop. Caps are set ABOVE the app limits so a normal write never
-- trips them — only abusive lengths are rejected.
--
-- Safe + idempotent: existing over-limit values are truncated first (so ADD
-- CONSTRAINT can't fail on old rows), and every constraint is dropped-if-exists
-- before re-adding, so this can be re-run at any time.

-- ── shops.description — the field you asked about (owner-entered, UI caps at 500)
update public.shops set description = left(description, 500)
  where description is not null and char_length(description) > 500;
alter table public.shops drop constraint if exists shops_description_len;
alter table public.shops add constraint shops_description_len
  check (description is null or char_length(description) <= 500);

-- ── appointments free-text — the highest-risk surface: the booking form is
--    PUBLIC/anonymous, so anyone can POST here without an account. Caps are
--    generous (block abuse, never a real name/note) — the server route already
--    clamps these tighter (name 100, note 500).
update public.appointments set client_name  = left(client_name, 500)   where client_name  is not null and char_length(client_name)  > 500;
update public.appointments set client_email = left(client_email, 320)  where client_email is not null and char_length(client_email) > 320;
update public.appointments set client_phone = left(client_phone, 50)   where client_phone is not null and char_length(client_phone) > 50;
update public.appointments set notes        = left(notes, 2000)        where notes        is not null and char_length(notes)        > 2000;

alter table public.appointments drop constraint if exists appt_client_name_len;
alter table public.appointments add constraint appt_client_name_len
  check (client_name is null or char_length(client_name) <= 500);

alter table public.appointments drop constraint if exists appt_client_email_len;
alter table public.appointments add constraint appt_client_email_len
  check (client_email is null or char_length(client_email) <= 320);

alter table public.appointments drop constraint if exists appt_client_phone_len;
alter table public.appointments add constraint appt_client_phone_len
  check (client_phone is null or char_length(client_phone) <= 50);

alter table public.appointments drop constraint if exists appt_notes_len;
alter table public.appointments add constraint appt_notes_len
  check (notes is null or char_length(notes) <= 2000);
