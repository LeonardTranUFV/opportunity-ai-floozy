-- ─────────────────────────────────────────────────────────────────────────
-- 0022: Floozy collects per area
--
-- Step 3 of the shared-leads plan. Needs 0021 (service_areas, groups.area_id,
-- groups.owner_kind). Floozy's own accounts ("collectors", listed in the env
-- var FLOOZY_COLLECTOR_USER_IDS) hold the area groups:
--
--   public groups   read through Apify, no Facebook login at all
--   private groups  read by the PC worker with a Floozy Facebook profile,
--                   slowly, from the home connection
--
-- So a group needs to say which of the two it is, and every read needs a
-- record: the daily Apify cap is counted from it, and the admin areas page
-- (step 6) shows last read, posts per day and failures from it.
--
-- Safe to run twice.
-- ─────────────────────────────────────────────────────────────────────────

-- null = not known yet. The worker treats unknown like private (it needs a
-- member's login to find out), Apify only takes groups marked public.
alter table groups add column if not exists access text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'groups_access_check') then
    alter table groups add constraint groups_access_check check (access is null or access in ('public', 'private'));
  end if;
end $$;

create table if not exists collector_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('apify', 'pc')),
  group_id uuid references groups(id) on delete set null,
  collector_id uuid references auth.users(id) on delete set null,
  area_id text references service_areas(id) on update cascade on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- What the source returned. For Apify this is what it bills for, so the
  -- daily cap sums this column, not posts_new.
  items integer not null default 0,
  -- Rows that were not in `posts` before this read.
  posts_new integer not null default 0,
  error text
);

create index if not exists collector_runs_source_day_idx on collector_runs (source, started_at desc);
create index if not exists collector_runs_group_idx on collector_runs (group_id, started_at desc);

-- Operator data. No policies: only the service role reads or writes it.
alter table collector_runs enable row level security;
