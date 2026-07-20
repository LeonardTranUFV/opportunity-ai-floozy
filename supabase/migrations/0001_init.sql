-- Opportunity AI — initial multi-tenant schema
-- Every table is scoped to auth.uid() via Row Level Security so each user
-- only ever sees their own agents, groups, posts, and opportunities.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────
-- agents: what each user's AI is looking for
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  goal text not null,
  location text,
  keywords text,
  negative_keywords text,
  created_at timestamptz not null default now()
);

alter table agents enable row level security;

create policy "agents_select_own" on agents for select using (auth.uid() = user_id);
create policy "agents_insert_own" on agents for insert with check (auth.uid() = user_id);
create policy "agents_update_own" on agents for update using (auth.uid() = user_id);
create policy "agents_delete_own" on agents for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- groups: monitored communities (Facebook/LinkedIn/etc)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  name text not null,
  url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);

alter table groups enable row level security;

create policy "groups_select_own" on groups for select using (auth.uid() = user_id);
create policy "groups_insert_own" on groups for insert with check (auth.uid() = user_id);
create policy "groups_update_own" on groups for update using (auth.uid() = user_id);
create policy "groups_delete_own" on groups for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- posts: raw scraped posts, before AI evaluation
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid references groups(id) on delete set null,
  platform text not null,
  external_post_id text,
  post_url text,
  author_name text not null,
  author_profile_url text,
  posted_at text,
  raw_text text not null,
  scraped_at timestamptz not null default now(),
  unique (user_id, external_post_id)
);

alter table posts enable row level security;

create policy "posts_select_own" on posts for select using (auth.uid() = user_id);
create policy "posts_insert_own" on posts for insert with check (auth.uid() = user_id);
create policy "posts_update_own" on posts for update using (auth.uid() = user_id);
create policy "posts_delete_own" on posts for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- opportunities: AI-scored opportunities, one per agent+post match
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  source_post_id uuid references posts(id) on delete set null,
  platform text,
  author_name text,
  author_profile_url text,
  post_url text,
  location_mentioned text,
  phone_number text,
  content text not null,
  category text,
  intent_score integer,
  urgency text,
  estimated_value text,
  ai_summary text,
  suggested_reply text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table opportunities enable row level security;

create policy "opportunities_select_own" on opportunities for select using (auth.uid() = user_id);
create policy "opportunities_insert_own" on opportunities for insert with check (auth.uid() = user_id);
create policy "opportunities_update_own" on opportunities for update using (auth.uid() = user_id);
create policy "opportunities_delete_own" on opportunities for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- evaluated_posts: dedupe tracking so a post is never re-scored by the
-- same agent twice
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists evaluated_posts (
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  source_post_id uuid not null references posts(id) on delete cascade,
  evaluated_at timestamptz not null default now(),
  primary key (agent_id, source_post_id)
);

alter table evaluated_posts enable row level security;

create policy "evaluated_posts_select_own" on evaluated_posts for select using (auth.uid() = user_id);
create policy "evaluated_posts_insert_own" on evaluated_posts for insert with check (auth.uid() = user_id);
create policy "evaluated_posts_delete_own" on evaluated_posts for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- settings: per-user AI persona / reasoning defaults
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table settings enable row level security;

create policy "settings_select_own" on settings for select using (auth.uid() = user_id);
create policy "settings_upsert_own" on settings for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on settings for update using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- indexes
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_agents_user on agents(user_id);
create index if not exists idx_groups_user on groups(user_id);
create index if not exists idx_posts_user on posts(user_id);
create index if not exists idx_posts_group on posts(group_id);
create index if not exists idx_opportunities_user on opportunities(user_id);
create index if not exists idx_opportunities_agent on opportunities(agent_id);
create index if not exists idx_opportunities_status on opportunities(user_id, status);
