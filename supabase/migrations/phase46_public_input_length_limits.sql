-- phase46_public_input_length_limits.sql
-- Round 2 of the free-text length backstop (see phase45 for shops + appointments).
-- Covers the remaining PUBLIC / anonymous write surfaces: the review form, the
-- waitlist join form, the client book (upsert from the anon booking flow), and
-- the signup-code request. Same rationale as phase45: NOT about SQL injection
-- (Supabase parameterizes every query) — this bounds LENGTH so no caller can
-- bloat the DB with a giant payload. Caps are generous (above the app's own
-- limits) so a normal value never trips them; only abuse is rejected.
--
-- Safe + idempotent: existing over-limit values are truncated first, and every
-- constraint is dropped-if-exists before re-adding. Re-runnable any time.

-- ── reviews (public review form; comment is free-text) ──────────────────────
update public.reviews set comment     = left(comment, 2000)   where comment     is not null and char_length(comment)     > 2000;
update public.reviews set client_name = left(client_name, 500) where client_name is not null and char_length(client_name) > 500;
alter table public.reviews drop constraint if exists reviews_comment_len;
alter table public.reviews add constraint reviews_comment_len
  check (comment is null or char_length(comment) <= 2000);
alter table public.reviews drop constraint if exists reviews_client_name_len;
alter table public.reviews add constraint reviews_client_name_len
  check (client_name is null or char_length(client_name) <= 500);

-- ── appointment_waitlist (public "join the waitlist" form) ──────────────────
update public.appointment_waitlist set client_name  = left(client_name, 500)  where client_name  is not null and char_length(client_name)  > 500;
update public.appointment_waitlist set client_email = left(client_email, 320) where client_email is not null and char_length(client_email) > 320;
update public.appointment_waitlist set client_phone = left(client_phone, 50)  where client_phone is not null and char_length(client_phone) > 50;
alter table public.appointment_waitlist drop constraint if exists wl_client_name_len;
alter table public.appointment_waitlist add constraint wl_client_name_len
  check (client_name is null or char_length(client_name) <= 500);
alter table public.appointment_waitlist drop constraint if exists wl_client_email_len;
alter table public.appointment_waitlist add constraint wl_client_email_len
  check (client_email is null or char_length(client_email) <= 320);
alter table public.appointment_waitlist drop constraint if exists wl_client_phone_len;
alter table public.appointment_waitlist add constraint wl_client_phone_len
  check (client_phone is null or char_length(client_phone) <= 50);

-- ── clients (upserted from the anonymous booking flow) ──────────────────────
update public.clients set name  = left(name, 200)  where name  is not null and char_length(name)  > 200;
update public.clients set email = left(email, 320) where email is not null and char_length(email) > 320;
update public.clients set phone = left(phone, 50)  where phone is not null and char_length(phone) > 50;
alter table public.clients drop constraint if exists clients_name_len;
alter table public.clients add constraint clients_name_len
  check (name is null or char_length(name) <= 200);
alter table public.clients drop constraint if exists clients_email_len;
alter table public.clients add constraint clients_email_len
  check (email is null or char_length(email) <= 320);
alter table public.clients drop constraint if exists clients_phone_len;
alter table public.clients add constraint clients_phone_len
  check (phone is null or char_length(phone) <= 50);

-- ── signup_codes (public "send me a code" request; email is the key) ────────
update public.signup_codes set email = left(email, 320) where email is not null and char_length(email) > 320;
alter table public.signup_codes drop constraint if exists signup_codes_email_len;
alter table public.signup_codes add constraint signup_codes_email_len
  check (email is null or char_length(email) <= 320);
