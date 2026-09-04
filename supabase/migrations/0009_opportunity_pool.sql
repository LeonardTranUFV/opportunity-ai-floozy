-- ─────────────────────────────────────────────────────────────────────────
-- 0009: the opportunity pool
--
-- The first cross-user-visible data in this app. Everything else in the
-- schema is walled off by `auth.uid() = user_id`; this deliberately is not,
-- so it gets its own guard rails rather than relying on the caller.
--
-- Two rules the application code must honour, encoded here as far as SQL can:
--
--   1. A user's opportunities enter the pool ONLY if that user opted in.
--      Consent lives in `settings` under key 'pool_opt_in' = 'true', written
--      at signup. `pooled_opportunities` below resolves that join once so no
--      caller has to remember it.
--
--   2. Every read of pooled data is logged. `pool_access_log` is written
--      BEFORE the rows are returned, and the read is refused if the write
--      fails — so there is no path that returns another user's data without
--      a record of who took it. This inverts the fail-open mistake this
--      project already made once: a missing table must block the feature,
--      never silently disable the check.
-- ─────────────────────────────────────────────────────────────────────────

-- Who looked at pooled data, when, and how much they took.
create table if not exists pool_access_log (
  id uuid primary key default gen_random_uuid(),
  -- The account that performed the read. Not "the admin" — an agency client
  -- may be granted access too, and the log must tell them apart.
  viewer_id uuid not null references auth.users(id) on delete cascade,
  action text not null,               -- 'list' | 'detail' | 'export'
  rows_returned integer not null default 0,
  -- Free-text record of the filter used, so a later audit can tell a targeted
  -- lookup from a bulk sweep.
  query_note text,
  created_at timestamptz not null default now()
);

create index if not exists pool_access_log_viewer_idx
  on pool_access_log (viewer_id, created_at desc);

alter table pool_access_log enable row level security;

-- Deliberately NO policies for ordinary users: the log is written and read
-- only by the service-role client, which bypasses RLS. A viewer must not be
-- able to read — or erase — the record of their own access.

-- ─────────────────────────────────────────────────────────────────────────
-- The pool itself: opportunities belonging to users who opted in.
--
-- A view, not a table, so there is exactly one copy of every opportunity and
-- revoking consent removes a user from the pool immediately — no backfill, no
-- orphaned duplicates of somebody's leads sitting in a second table after
-- they opted out.
-- ─────────────────────────────────────────────────────────────────────────
create or replace view pooled_opportunities as
select
  o.id,
  o.user_id,
  o.platform,
  o.author_name,
  o.author_profile_url,
  o.post_url,
  o.location_mentioned,
  o.phone_number,
  o.content,
  o.category,
  o.intent_score,
  o.urgency,
  o.estimated_value,
  o.ai_summary,
  o.status,
  o.created_at
from opportunities o
join settings s
  on s.user_id = o.user_id
 and s.key = 'pool_opt_in'
 and s.value = 'true';

-- `security_invoker` keeps the caller's RLS in force through the view, so an
-- ordinary logged-in user selecting from it still sees only their own rows.
-- Only the service-role client — behind the admin check in lib/pool.ts — sees
-- across users. Without this the view would run as its owner and hand every
-- authenticated user the whole pool.
alter view pooled_opportunities set (security_invoker = on);

-- ─────────────────────────────────────────────────────────────────────────
-- Consent and access keys used in `settings` (no DDL needed — settings is a
-- generic per-user key/value table). Recorded here so the schema documents
-- them:
--
--   pool_opt_in            'true' | 'false'  — user contributes to the pool
--   pool_consent_version   e.g. '2026-08-11' — which terms they accepted
--   terms_accepted_at      ISO timestamp     — when they accepted
--   pool_access            'true'            — SUPERSEDED, see below
--   is_admin               'true'            — SUPERSEDED, see below
--
-- SUPERSEDED by 0016_privileges_out_of_settings.sql. Storing those two here
-- was a mistake: `settings` lets a user write their own rows, so reading
-- authorization from it let any account grant itself admin and pool access.
-- Both now come from environment variables (lib/privileges.ts). The rows are
-- deleted in 0016 and nothing reads these keys any more.
--
-- The distinction they encoded still holds and still applies to the env vars:
-- pool read access is separate from admin on purpose, so a paying agency
-- client can be given sight of the pool without the ability to grant it on.
-- ─────────────────────────────────────────────────────────────────────────
