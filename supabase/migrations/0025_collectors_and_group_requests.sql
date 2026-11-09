-- ─────────────────────────────────────────────────────────────────────────
-- 0025: Floozy's Facebook accounts, and clients asking for groups
--
-- floozy_collectors  the accounts Floozy reads Facebook groups with. Until now
--                    the list lived only in FLOOZY_COLLECTOR_USER_IDS, so adding
--                    one meant editing Vercel. That variable still counts; this
--                    table adds to it. Not in `settings`, because customers can
--                    write their own settings rows and this grants access.
--
-- group_requests     a client asking Floozy to watch a Facebook group. A person
--                    at Floozy joins it with one of the accounts above and then
--                    turns collection on. Clients read their own requests; only
--                    the service role writes, so the status can't be self-served.
--
-- Safe to run twice.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists floozy_collectors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Operator data: no policies, service role only.
alter table floozy_collectors enable row level security;

create table if not exists group_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  name text,
  note text,
  status text not null default 'requested' check (status in ('requested', 'joining', 'active', 'declined')),
  collector_id uuid references auth.users(id) on delete set null,
  group_id uuid references groups(id) on delete set null,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, url)
);

create index if not exists group_requests_open_idx on group_requests (status, created_at desc);
create index if not exists group_requests_group_idx on group_requests (group_id) where group_id is not null;

alter table group_requests enable row level security;

drop policy if exists "group_requests_select_own" on group_requests;
create policy "group_requests_select_own" on group_requests for select using (auth.uid() = user_id);
