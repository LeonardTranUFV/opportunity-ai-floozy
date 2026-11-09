-- ─────────────────────────────────────────────────────────────────────────
-- 0024: a record of every operator account switch
--
-- The account switcher signs a Floozy operator in as a client, so there has to
-- be a record of who went into which account and when.
--
-- Operator data, like collector_runs: no policies, service role only. A client
-- has no reason to read it and must never be able to edit it.
--
-- Safe to run twice.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists account_switches (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid references auth.users(id) on delete set null,
  from_user_id uuid references auth.users(id) on delete set null,
  to_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists account_switches_recent_idx on account_switches (created_at desc);

alter table account_switches enable row level security;
