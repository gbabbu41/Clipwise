-- New private prospect records only. No auth users, bookings or portal tables change.
create table public.marketing_leads (
  email text primary key check (length(email) between 3 and 254 and email = lower(btrim(email))),
  plan text not null check (plan in ('starter','pro','premium')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  notice_version text not null default 'signup-interest-v1',
  marketing_opt_in boolean not null default false check (marketing_opt_in = false)
);
create index marketing_leads_expiry_idx on public.marketing_leads(expires_at);
create table public.marketing_signup_drafts (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  email text not null references public.marketing_leads(email) on delete cascade,
  plan text not null check (plan in ('starter','pro','premium')),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);
create index marketing_drafts_ip_created_idx on public.marketing_signup_drafts(ip_hash, created_at);
create index marketing_drafts_email_created_idx on public.marketing_signup_drafts(email, created_at);
create index marketing_drafts_created_idx on public.marketing_signup_drafts(created_at);
alter table public.marketing_leads enable row level security;
alter table public.marketing_signup_drafts enable row level security;
revoke all on public.marketing_leads, public.marketing_signup_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.marketing_leads, public.marketing_signup_drafts to service_role;

-- Invoker permissions: only the server's service_role may execute. A transaction
-- lock makes rate limits and lead/draft inserts atomic across serverless instances.
create function public.capture_marketing_lead(p_email text, p_plan text, p_token_hash text, p_ip_hash text)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  if p_email is null or length(p_email) > 254 or p_email <> lower(btrim(p_email))
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_plan is null or p_plan not in ('starter','pro','premium')
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid signup interest';
  end if;
  -- One lightweight lock for this low-volume public funnel also bounds the daily
  -- ceiling. There are no network calls inside this transaction.
  perform pg_catalog.pg_advisory_xact_lock(71824591);
  if (select count(*) from public.marketing_signup_drafts where ip_hash=p_ip_hash and created_at > now()-interval '1 hour') >= 10
    or (select count(*) from public.marketing_signup_drafts where email=p_email and created_at > now()-interval '1 hour') >= 5
    or (select count(*) from public.marketing_signup_drafts where created_at > now()-interval '24 hours') >= 5000 then
    return 'limited';
  end if;
  insert into public.marketing_leads(email,plan) values(p_email,p_plan)
    on conflict(email) do update set plan=excluded.plan, created_at=now(), expires_at=now()+interval '30 days'
    where public.marketing_leads.expires_at <= now();
  insert into public.marketing_signup_drafts(token_hash,email,plan,ip_hash) values(p_token_hash,p_email,p_plan,p_ip_hash);
  return 'saved';
end;
$$;
revoke all on function public.capture_marketing_lead(text,text,text,text) from public, anon, authenticated;
grant execute on function public.capture_marketing_lead(text,text,text,text) to service_role;
