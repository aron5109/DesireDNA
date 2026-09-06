-- Atomic rate limiting and per-owner budgets.
--
-- The previous implementation counted rows and then inserted one, so two
-- concurrent requests could both read a count below the limit and both proceed.
-- This function does the count and the insert in a single statement under one
-- transaction, and returns whether the caller is allowed plus when the window
-- frees up again.

create index if not exists rate_limit_window_idx
  on public.rate_limit_events (key_hash, action, created_at desc);

create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, used integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  current_count integer;
  oldest timestamptz;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'invalid rate limit parameters';
  end if;

  -- Serialise callers sharing a key/action pair so the count cannot be read
  -- concurrently by two requests that both then insert.
  perform pg_advisory_xact_lock(hashtextextended(p_key_hash || ':' || p_action, 0));

  select count(*), min(created_at)
    into current_count, oldest
    from rate_limit_events
   where key_hash = p_key_hash
     and action = p_action
     and created_at >= window_start;

  if current_count >= p_limit then
    return query
      select false,
             current_count,
             greatest(1, ceil(extract(epoch from (oldest + make_interval(secs => p_window_seconds)) - now()))::integer);
    return;
  end if;

  insert into rate_limit_events (key_hash, action) values (p_key_hash, p_action);

  return query select true, current_count + 1, 0;
end
$$;

-- Only the server-side service role may call this.
revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
