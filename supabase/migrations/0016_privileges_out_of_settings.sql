-- ─────────────────────────────────────────────────────────────────────────
-- Remove privilege flags from `settings`.
--
-- `is_admin` and `pool_access` lived here and were read as authorization:
-- lib/admin.ts and lib/pool.ts selected the row and compared it to 'true'.
--
-- `settings` is the per-user key/value table holding each customer's business
-- profile and AI preferences, and its policies deliberately let them write
-- their own rows — settings_upsert_own and settings_update_own, both defined
-- in 0001_init.sql. So the permission check read a value its own subject could
-- write. Any signed-up account could POST {"is_admin":"true"} to
-- /api/settings, or write the row straight through PostgREST with the anon key
-- the browser already holds, and gain:
--
--   * credit grants and deductions against ANY account (/api/admin/credits)
--   * read access to the shared pool — other customers' leads
--
-- Both now resolve from the deployment environment instead (ADMIN_USER_IDS /
-- ADMIN_EMAILS, POOL_ACCESS_USER_IDS / POOL_ACCESS_EMAILS — see
-- lib/privileges.ts), which no request can reach and which fails closed when
-- unset.
--
-- The rows left behind are inert: nothing reads these keys any more. They are
-- deleted anyway, because a row named `is_admin` sitting in a table users can
-- write is an invitation for someone to wire it back up.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────

delete from settings where key in ('is_admin', 'pool_access');

-- Opt-in stays. It is the customer's own consent to contribute their leads to
-- the pool, so it is exactly the kind of value they SHOULD be able to write
-- about themselves — the opposite of a privilege. `pooled_opportunities`
-- still joins on it (see 0009).
comment on table settings is
  'Per-user preferences and consent. NEVER store authorization here - users can write their own rows (see 0001 policies). Admin and pool-read access come from environment variables; see lib/privileges.ts and migration 0016.';
