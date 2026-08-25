-- ─────────────────────────────────────────────────────────────────────────
-- Portable browser sessions.
--
-- Until now a customer's Facebook/LinkedIn/Nextdoor/X login lived as a
-- Playwright persistent-context DIRECTORY on one operator's PC
-- (`../.auth_sessions/<user_id>/<platform>`, see lib/auth-session.ts). That
-- works, and it is why the local worker can crawl at all — but it pins every
-- customer to a single machine. Nobody can self-connect from the hosted site,
-- because a Vercel function has no disk that outlives the request, and a
-- second worker box could never pick up work the first one holds.
--
-- Playwright can serialise everything that actually constitutes a login —
-- cookies plus localStorage — into a `storageState` JSON blob, and rehydrate
-- a fresh context from it anywhere. Storing that blob here instead of on one
-- disk is what makes the crawler relocatable: any worker, in any datacentre,
-- can load any customer's session on demand.
--
-- The blob is a live credential. Anyone holding it IS that customer on that
-- platform, without a password and without tripping 2FA. So it is encrypted
-- with AES-256-GCM before it ever reaches this table (lib/session-crypto.ts)
-- and the key lives only in the server environment. A database dump alone is
-- therefore not enough to impersonate anyone.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists browser_sessions (
  user_id           uuid not null references auth.users(id) on delete cascade,
  platform          text not null check (platform in ('facebook', 'linkedin', 'nextdoor', 'twitter')),

  -- AES-256-GCM output, all base64. Split into three columns rather than one
  -- packed string so a malformed row is obvious on inspection instead of
  -- failing deep inside the decrypt call.
  state_ciphertext  text not null,
  state_iv          text not null,
  state_tag         text not null,

  -- Which encryption key sealed this row. Rotating the key means writing new
  -- rows at version+1 and keeping the old key available until the last v1 row
  -- is gone; without this column a rotation silently bricks every session.
  key_version       integer not null default 1,

  -- 'active'  — believed usable
  -- 'expired' — the platform rejected it; the customer must reconnect
  -- 'revoked' — the customer disconnected on purpose
  --
  -- A row is kept rather than deleted on expiry so the UI can say "your
  -- Facebook connection expired" instead of silently showing "not connected",
  -- which reads as though the app forgot.
  status            text not null default 'active' check (status in ('active', 'expired', 'revoked')),

  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Last time a real request to the platform confirmed the session still
  -- works. Presence of a row is never proof of validity — cookies expire in
  -- place — so the worker uses this to prefer recently-verified sessions.
  last_verified_at  timestamptz,

  primary key (user_id, platform)
);

-- The worker asks "which sessions can I run right now?" across all users, so
-- the useful index is by status, not by user.
create index if not exists browser_sessions_status_idx
  on browser_sessions (status, platform);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS: enabled with NO policies, deliberately.
--
-- That makes this table unreachable for anon and authenticated callers
-- entirely — only the service-role client can touch it. This is stricter
-- than the usual "user sees their own rows" pattern on purpose: Postgres RLS
-- filters rows, not columns, so any policy that let a customer read their own
-- row would also hand them their own ciphertext, IV and tag over PostgREST.
-- There is no reason for a browser to ever hold those bytes.
--
-- The UI still needs to know whether a platform is connected. That goes
-- through a server route using the admin client and filtering by the logged-in
-- user id — the same shape app/api/accounts/status/route.ts already uses — so
-- the answer reaching the browser is a boolean and a timestamp, never the
-- credential itself.
-- ─────────────────────────────────────────────────────────────────────────
alter table browser_sessions enable row level security;
