-- phase35_error_logs.sql
-- Central capture of client + server runtime errors, surfaced in the CEO admin
-- panel (/admin/errors) and mirrored to Vercel logs for engineering. Written
-- only by server routes via the service-role key; RLS is ON with NO public
-- policies, so the anon/authed clients can never read or write it directly.

create table if not exists public.error_logs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  level       text not null default 'error',   -- 'error' | 'warning'
  source      text,                             -- 'window' | 'unhandledrejection' | 'react-boundary' | 'react-global' | 'server'
  message     text not null,
  stack       text,
  path        text,                             -- pathname only (never query strings / PII)
  user_agent  text,
  user_id     text,                             -- best-effort, may be null
  shop_id     text                              -- best-effort, may be null
);

create index if not exists error_logs_created_at_idx on public.error_logs (created_at desc);

alter table public.error_logs enable row level security;
-- Intentionally NO policies: only the service-role key (used by API routes) can
-- touch this table. Direct anon/authenticated access is denied by default.
