create extension if not exists pgcrypto;
create table public.quiz_profiles (
 id uuid primary key default gen_random_uuid(), owner_token_hash text unique not null, share_code_hash text unique not null,
 payload_ciphertext text not null, payload_iv text not null, payload_auth_tag text not null,
 encryption_key_version integer not null default 1 check (encryption_key_version > 0), quiz_version text not null,
 share_mode text not null default 'mutual_only' check (share_mode in ('mutual_only','full_comparison')),
 consent_version text not null, created_at timestamptz not null default now(), expires_at timestamptz not null,
 revoked_at timestamptz null, constraint valid_expiry check (expires_at > created_at),
 constraint max_retention check (expires_at <= created_at + interval '30 days 5 minutes')
);
create table public.rate_limit_events (id bigint generated always as identity primary key,key_hash text not null,action text not null,created_at timestamptz not null default now());
create index quiz_profiles_share_code_idx on public.quiz_profiles(share_code_hash);create index quiz_profiles_owner_idx on public.quiz_profiles(owner_token_hash);create index quiz_profiles_expiry_idx on public.quiz_profiles(expires_at);create index rate_limit_lookup_idx on public.rate_limit_events(key_hash,action,created_at);
alter table public.quiz_profiles enable row level security;alter table public.rate_limit_events enable row level security;
revoke all on public.quiz_profiles from anon, authenticated;revoke all on public.rate_limit_events from anon, authenticated;
create or replace function public.purge_desiredna_data() returns table(profiles_deleted bigint,events_deleted bigint) language plpgsql security definer set search_path=public as $$ declare p bigint;e bigint;begin delete from quiz_profiles where expires_at<=now();get diagnostics p=row_count;delete from rate_limit_events where created_at<now()-interval '31 days';get diagnostics e=row_count;return query select p,e;end$$;
revoke all on function public.purge_desiredna_data() from public,anon,authenticated;
