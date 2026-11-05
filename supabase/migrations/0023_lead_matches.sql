-- ─────────────────────────────────────────────────────────────────────────
-- 0023: the matcher hands Floozy's area leads to clients
--
-- Step 4 of the shared-leads plan. Needs 0021 and 0022. lib/lead-matcher.ts
-- classifies each post from a Floozy area group once (a real request? which
-- trade? which city?), scores the requests once per trade, and gives each
-- lead at 60+ to the best-fitting clients (MATCH_MAX_CLIENTS, default 5) in
-- that trade and area.
--
-- A delivered lead is an ordinary `opportunities` row in the client's own
-- account, so the dashboard, CRM, drafts and the morning email work on it as
-- they are. Clients never get read access to Floozy's `posts`: the row carries
-- what the card needs (text, author, link, date, which group).
--
-- Safe to run twice.
-- ─────────────────────────────────────────────────────────────────────────

-- 'own'    = found in the client's own sources by their own agent (all rows so far)
-- 'floozy' = found by Floozy in an area group and handed to this client
alter table opportunities add column if not exists source_kind text not null default 'own';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'opportunities_source_kind_check') then
    alter table opportunities add constraint opportunities_source_kind_check check (source_kind in ('own', 'floozy'));
  end if;
end $$;

-- The card says "Found by Floozy in <group>"; the client cannot read the group row.
alter table opportunities add column if not exists source_group_name text;
-- The post's own date as the platform gave it (posts.posted_at is text too),
-- because the card's usual join to `posts` is closed to the client.
alter table opportunities add column if not exists source_posted_at text;
-- One line on why this client got it ("Roofing in Burnaby, your area").
alter table opportunities add column if not exists match_note text;

-- Who got which post. The primary key is what makes a re-run harmless, and
-- counting rows per post is what enforces the "at most N clients" rule.
create table if not exists lead_matches (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete set null,
  score integer not null,
  rank smallint not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- For fairness: clients who got fewer leads lately go first on a tie.
create index if not exists lead_matches_user_recent_idx on lead_matches (user_id, created_at desc);

-- Operator data, like collector_runs: no policies, service role only. A client
-- must not see which other businesses were sent the same lead.
alter table lead_matches enable row level security;
