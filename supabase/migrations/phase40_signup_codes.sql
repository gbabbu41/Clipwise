-- Pre-signup email verification codes (verify-first, create-after).
-- Only {email, code} live here until the code is verified; the real account is
-- created only after verification, then this row is deleted. RLS on with NO
-- policies → service-role (server API routes) only; anon/public cannot touch it.
-- NOTE: already applied to prod via MCP on 2026-08-04; kept here for the record.
create table if not exists public.signup_codes (
  email        text primary key,
  code         text not null,
  role         text,
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  last_sent_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
alter table public.signup_codes enable row level security;
comment on table public.signup_codes is 'Pre-signup email verification codes. No account/password stored until the code is verified.';
