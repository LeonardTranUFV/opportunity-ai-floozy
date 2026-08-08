-- Shared-store rate limiting.
--
-- Replaces the per-process in-memory counter. On Vercel each serverless
-- instance kept its own map, so a caller hitting N instances got N times the
-- limit, and every deploy reset every counter. This moves the state somewhere
-- all instances share.
--
-- SAFE TO APPLY AT ANY TIME. The application already runs without this: if the
-- function below is missing it falls back to the old in-memory limiter and logs
-- loudly, so nothing fails open while this is unapplied. Once you paste it the
-- app picks it up on its own within a minute — no redeploy needed.
--
-- Paste into Supabase → SQL Editor → Run.

create table if not exists rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (key, window_start)
);

-- Only used to sweep expired rows.
create index if not exists rate_limits_window_start_idx on rate_limits (window_start);

-- No policies are defined on purpose. RLS on with zero policies means no
-- ordinary client can read or write this table at all; the service role
-- bypasses RLS and is the only thing that touches it.
alter table rate_limits enable row level security;

-- Increment and return the new count, atomically.
--
-- The atomicity is the entire point. Read-then-write from the application would
-- race between concurrent serverless invocations and let a burst through — the
-- exact failure this table exists to prevent. `on conflict do update` makes the
-- increment a single statement the database serialises for us.
create or replace function bump_rate_limit(
  p_key          text,
  p_window_start timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into rate_limits (key, window_start, count)
  values (p_key, p_window_start, 1)
  on conflict (key, window_start)
    do update set count = rate_limits.count + 1
  returning count into new_count;

  -- Opportunistic sweep, roughly one call in two hundred. Cheap enough inline,
  -- and it means this table never needs a scheduled job on a project that has
  -- no scheduler.
  if random() < 0.005 then
    delete from rate_limits where window_start < now() - interval '24 hours';
  end if;

  return new_count;
end;
$$;

-- Reachable only by the service role. `security definer` would otherwise let
-- any authenticated caller inflate their own counter — or somebody else's.
revoke all on function bump_rate_limit(text, timestamptz) from public;
revoke all on function bump_rate_limit(text, timestamptz) from anon;
revoke all on function bump_rate_limit(text, timestamptz) from authenticated;
grant execute on function bump_rate_limit(text, timestamptz) to service_role;
