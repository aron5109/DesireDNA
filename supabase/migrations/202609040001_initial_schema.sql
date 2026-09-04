-- DesireDNA initial schema.
--
-- Every row is opaque: the answers and result live inside an AES-256-GCM
-- payload encrypted by the application, and the owner token and DesireCode are
-- stored only as keyed HMAC hashes. Row Level Security is enabled with no
-- policies, so anon and authenticated clients can reach nothing; all access
-- goes through the server-side service role.

create extension if not exists pgcrypto;

create table if not exists public.quiz_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_token_hash text unique not null,
  share_code_hash text unique not null,
  payload_ciphertext text not null,
  payload_iv text not null,
  payload_auth_tag text not null,
  encryption_key_version integer not null default 1 check (encryption_key_version > 0),
  quiz_version text not null,
  share_mode text not null default 'mutual_only'
    check (share_mode in ('mutual_only', 'full_comparison')),
  consent_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  constraint valid_expiry check (expires_at > created_at),
  -- Retention is capped in the database as well as in the API. The extra
  -- minutes absorb clock skew between the app server and Postgres.
  constraint max_retention check (expires_at <= created_at + interval '30 days 5 minutes')
);

create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  key_hash text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists quiz_profiles_share_code_idx on public.quiz_profiles (share_code_hash);
create index if not exists quiz_profiles_owner_idx on public.quiz_profiles (owner_token_hash);
create index if not exists quiz_profiles_expiry_idx on public.quiz_profiles (expires_at);
create index if not exists rate_limit_lookup_idx
  on public.rate_limit_events (key_hash, action, created_at);

alter table public.quiz_profiles enable row level security;
alter table public.rate_limit_events enable row level security;

revoke all on public.quiz_profiles from anon, authenticated;
revoke all on public.rate_limit_events from anon, authenticated;

-- Scheduled cleanup. /api/maintenance/purge performs the same deletions, so
-- this function exists for operators who prefer a database-side pg_cron job.
create or replace function public.purge_desiredna_data()
returns table (profiles_deleted bigint, events_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_profiles bigint;
  removed_events bigint;
begin
  delete from quiz_profiles where expires_at <= now();
  get diagnostics removed_profiles = row_count;

  delete from rate_limit_events where created_at < now() - interval '31 days';
  get diagnostics removed_events = row_count;

  return query select removed_profiles, removed_events;
end
$$;

revoke all on function public.purge_desiredna_data() from public, anon, authenticated;
