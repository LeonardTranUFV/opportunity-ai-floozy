-- Stop the browser from being able to write credit balances.
--
-- adjust_credits() is SECURITY DEFINER and takes the target user id as an
-- argument. Postgres grants EXECUTE on new functions to PUBLIC by default, and
-- PostgREST exposes every executable function as an RPC endpoint — so the
-- function was reachable straight from the browser using the public anon key,
-- with the caller choosing both the user id and the amount. The RLS policy on
-- user_credits was never the protection anyone assumed: it correctly limits
-- direct table access to read-your-own, and the RPC walked around it.
--
-- The practical consequences were an account granting itself an unlimited
-- balance, and an account zeroing out someone else's, neither of which leaves
-- a trace distinguishable from legitimate use — adjust_credits writes the
-- credit_transactions audit row itself, so the forged change looks booked.
--
-- Confirmed against the live database before writing this: an anon-key call to
-- the RPC reached the function body and failed on a foreign key constraint
-- (23503), not on permissions. A revoked function answers 42501 instead.
--
-- Safe to apply because lib/credits.ts now issues every adjust_credits call
-- through the service-role client, which is exempt from these grants. Apply
-- the code change first, or credit spending breaks for everyone.

revoke execute on function adjust_credits(uuid, integer, text, jsonb) from public;
revoke execute on function adjust_credits(uuid, integer, text, jsonb) from anon;
revoke execute on function adjust_credits(uuid, integer, text, jsonb) from authenticated;

-- service_role is what the server uses; state the grant explicitly rather than
-- relying on it having been inherited from the PUBLIC grant being removed.
grant execute on function adjust_credits(uuid, integer, text, jsonb) to service_role;
