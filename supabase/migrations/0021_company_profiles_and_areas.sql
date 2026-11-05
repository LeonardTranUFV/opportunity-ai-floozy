-- ─────────────────────────────────────────────────────────────────────────
-- 0021: company profiles and service areas
--
-- Step 2 of the shared-leads plan. Until now every client was a silo: they
-- connected their own accounts, scraped their own groups, and saw only the
-- posts they collected. The new model is that Floozy collects per area with
-- its own accounts and hands each matching lead to up to 3 clients. That
-- needs four things the schema did not have:
--
--   1. service_areas         the places Floozy collects in (one per commuting
--                            cluster in lib/nearby-cities.ts; seeded below)
--   2. company_profiles      who the client is and what jobs they want, as
--                            real columns instead of 4 loose settings keys
--   3. client_service_areas  which areas (and optionally which cities in
--                            them) each client works
--   4. area + owner on groups, and trade / intent / area on posts, so the
--      matcher (step 4) can route one post to many clients
--
-- Nothing here shares data between users yet. Every new table is owner-only
-- except service_areas, which is a public list of city names. 0020 is the
-- skeptic-pass branch's number, so this is 0021 even if 0020 is not applied.
--
-- Safe to run twice.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. service_areas ───────────────────────────────────────────────────────
create table if not exists service_areas (
  -- The slug from lib/service-areas.ts areaSlug(), e.g. 'metro-vancouver'.
  id text primary key,
  name text not null,
  country text not null check (country in ('CA', 'US')),
  cities text[] not null default '{}',
  -- For retiring an area without breaking the clients who chose it.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table service_areas enable row level security;

-- City names only, nothing private: any signed-in user may read the list.
-- No write policies, so only the service role (and the SQL editor) can edit it.
drop policy if exists "service_areas_read" on service_areas;
create policy "service_areas_read" on service_areas for select to authenticated using (true);

-- Generated from lib/service-areas.ts (serviceAreaSeedSql). npm run check
-- fails if this list and the code drift apart.
insert into service_areas (id, name, country, cities) values
  ('metro-vancouver', 'Metro Vancouver', 'CA', array['Vancouver', 'Burnaby', 'Richmond', 'Surrey', 'Coquitlam', 'Port Coquitlam', 'Port Moody', 'New Westminster', 'North Vancouver', 'West Vancouver', 'Delta', 'Langley', 'Maple Ridge', 'White Rock']),
  ('vancouver-island', 'Vancouver Island', 'CA', array['Victoria', 'Saanich', 'Nanaimo', 'Langford', 'Colwood']),
  ('fraser-valley', 'Fraser Valley', 'CA', array['Abbotsford', 'Chilliwack', 'Mission']),
  ('okanagan', 'Okanagan', 'CA', array['Kelowna', 'West Kelowna', 'Kamloops', 'Vernon', 'Penticton']),
  ('northern-bc', 'Northern BC', 'CA', array['Prince George']),
  ('calgary', 'Calgary', 'CA', array['Calgary', 'Airdrie', 'Cochrane', 'Okotoks', 'Chestermere']),
  ('edmonton', 'Edmonton', 'CA', array['Edmonton', 'St. Albert', 'Sherwood Park', 'Spruce Grove', 'Leduc', 'Fort Saskatchewan']),
  ('saskatchewan', 'Saskatchewan', 'CA', array['Saskatoon', 'Regina']),
  ('winnipeg', 'Winnipeg', 'CA', array['Winnipeg', 'Steinbach']),
  ('greater-toronto', 'Greater Toronto', 'CA', array['Toronto', 'Mississauga', 'Brampton', 'Vaughan', 'Markham', 'Richmond Hill', 'Oakville', 'Burlington', 'Milton', 'Pickering', 'Ajax', 'Whitby', 'Oshawa', 'Newmarket', 'Aurora']),
  ('hamilton-niagara', 'Hamilton–Niagara', 'CA', array['Hamilton', 'St. Catharines', 'Niagara Falls', 'Grimsby']),
  ('waterloo-region', 'Waterloo Region', 'CA', array['Kitchener', 'Waterloo', 'Cambridge', 'Guelph']),
  ('london-ontario', 'London, Ontario', 'CA', array['London', 'St. Thomas', 'Strathroy']),
  ('ottawa-gatineau', 'Ottawa–Gatineau', 'CA', array['Ottawa', 'Gatineau', 'Kanata', 'Orléans', 'Nepean']),
  ('greater-montreal', 'Greater Montréal', 'CA', array['Montréal', 'Laval', 'Longueuil', 'Brossard', 'Terrebonne', 'Repentigny', 'Saint-Jérôme']),
  ('quebec-city', 'Québec City', 'CA', array['Québec City', 'Lévis']),
  ('halifax', 'Halifax', 'CA', array['Halifax', 'Dartmouth', 'Bedford']),
  ('moncton', 'Moncton', 'CA', array['Moncton', 'Dieppe', 'Riverview']),
  ('seattle-tacoma', 'Seattle–Tacoma', 'US', array['Seattle', 'Bellevue', 'Tacoma', 'Everett', 'Kent', 'Renton', 'Kirkland', 'Redmond']),
  ('portland', 'Portland', 'US', array['Portland', 'Beaverton', 'Hillsboro', 'Gresham', 'Vancouver WA']),
  ('san-francisco-bay-area', 'San Francisco Bay Area', 'US', array['San Francisco', 'Oakland', 'San Jose', 'Fremont', 'Berkeley', 'Sunnyvale', 'Santa Clara', 'Hayward']),
  ('sacramento', 'Sacramento', 'US', array['Sacramento', 'Roseville', 'Elk Grove', 'Folsom']),
  ('los-angeles', 'Los Angeles', 'US', array['Los Angeles', 'Long Beach', 'Pasadena', 'Glendale', 'Burbank', 'Torrance', 'Santa Monica', 'Inglewood']),
  ('orange-county', 'Orange County', 'US', array['Anaheim', 'Irvine', 'Santa Ana', 'Huntington Beach', 'Orange', 'Fullerton']),
  ('inland-empire', 'Inland Empire', 'US', array['Riverside', 'San Bernardino', 'Ontario', 'Rancho Cucamonga', 'Corona', 'Temecula']),
  ('san-diego', 'San Diego', 'US', array['San Diego', 'Chula Vista', 'Oceanside', 'Escondido', 'Carlsbad', 'El Cajon']),
  ('las-vegas', 'Las Vegas', 'US', array['Las Vegas', 'Henderson', 'North Las Vegas', 'Summerlin']),
  ('phoenix', 'Phoenix', 'US', array['Phoenix', 'Mesa', 'Scottsdale', 'Chandler', 'Gilbert', 'Glendale AZ', 'Tempe', 'Peoria']),
  ('denver', 'Denver', 'US', array['Denver', 'Aurora CO', 'Lakewood', 'Arvada', 'Westminster', 'Littleton', 'Boulder']),
  ('salt-lake-city', 'Salt Lake City', 'US', array['Salt Lake City', 'West Valley City', 'Sandy', 'Provo', 'Ogden']),
  ('dallas-fort-worth', 'Dallas–Fort Worth', 'US', array['Dallas', 'Fort Worth', 'Arlington', 'Plano', 'Irving', 'Frisco', 'McKinney', 'Garland', 'Denton']),
  ('houston', 'Houston', 'US', array['Houston', 'Sugar Land', 'Pearland', 'The Woodlands', 'Katy', 'Pasadena TX', 'League City', 'Cypress']),
  ('austin', 'Austin', 'US', array['Austin', 'Round Rock', 'Cedar Park', 'Georgetown', 'Pflugerville']),
  ('san-antonio', 'San Antonio', 'US', array['San Antonio', 'New Braunfels', 'Schertz']),
  ('minneapolis-st-paul', 'Minneapolis–St. Paul', 'US', array['Minneapolis', 'St. Paul', 'Bloomington', 'Plymouth', 'Eden Prairie', 'Maple Grove']),
  ('chicago', 'Chicago', 'US', array['Chicago', 'Naperville', 'Aurora IL', 'Joliet', 'Evanston', 'Schaumburg', 'Oak Park', 'Elgin']),
  ('detroit', 'Detroit', 'US', array['Detroit', 'Dearborn', 'Livonia', 'Troy', 'Warren', 'Sterling Heights', 'Ann Arbor']),
  ('columbus', 'Columbus', 'US', array['Columbus', 'Dublin', 'Westerville', 'Hilliard', 'Grove City']),
  ('cleveland', 'Cleveland', 'US', array['Cleveland', 'Parma', 'Lakewood OH', 'Akron']),
  ('indianapolis', 'Indianapolis', 'US', array['Indianapolis', 'Carmel', 'Fishers', 'Greenwood', 'Noblesville']),
  ('nashville', 'Nashville', 'US', array['Nashville', 'Franklin', 'Murfreesboro', 'Hendersonville', 'Brentwood']),
  ('atlanta', 'Atlanta', 'US', array['Atlanta', 'Marietta', 'Alpharetta', 'Sandy Springs', 'Roswell', 'Decatur', 'Lawrenceville']),
  ('charlotte', 'Charlotte', 'US', array['Charlotte', 'Concord', 'Gastonia', 'Huntersville', 'Matthews']),
  ('raleigh-durham', 'Raleigh–Durham', 'US', array['Raleigh', 'Durham', 'Cary', 'Chapel Hill', 'Apex']),
  ('tampa-bay', 'Tampa Bay', 'US', array['Tampa', 'St. Petersburg', 'Clearwater', 'Brandon', 'Largo']),
  ('orlando', 'Orlando', 'US', array['Orlando', 'Kissimmee', 'Sanford', 'Winter Park', 'Apopka']),
  ('south-florida', 'South Florida', 'US', array['Miami', 'Fort Lauderdale', 'Hollywood', 'Boca Raton', 'West Palm Beach', 'Coral Springs', 'Pembroke Pines']),
  ('jacksonville', 'Jacksonville', 'US', array['Jacksonville', 'Orange Park', 'St. Augustine']),
  ('washington-dc', 'Washington, DC', 'US', array['Washington', 'Arlington VA', 'Alexandria', 'Bethesda', 'Silver Spring', 'Fairfax', 'Rockville']),
  ('baltimore', 'Baltimore', 'US', array['Baltimore', 'Towson', 'Columbia MD', 'Glen Burnie']),
  ('philadelphia', 'Philadelphia', 'US', array['Philadelphia', 'Cherry Hill', 'Camden', 'King of Prussia', 'Norristown', 'Wilmington']),
  ('pittsburgh', 'Pittsburgh', 'US', array['Pittsburgh', 'Cranberry Township', 'Monroeville', 'Bethel Park']),
  ('new-york-city', 'New York City', 'US', array['New York', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island', 'Yonkers', 'Jersey City', 'Newark', 'Hoboken']),
  ('long-island', 'Long Island', 'US', array['Hempstead', 'Huntington', 'Islip', 'Brookhaven', 'Oyster Bay']),
  ('boston', 'Boston', 'US', array['Boston', 'Cambridge MA', 'Somerville', 'Quincy', 'Newton', 'Brookline', 'Waltham'])
on conflict (id) do update
  set name = excluded.name, country = excluded.country, cities = excluded.cities;

-- ── 2. company_profiles ────────────────────────────────────────────────────
create table if not exists company_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,

  business_name text,
  owner_name text,
  phone text,
  website text,
  -- What makes them stand out, in their words. Was settings.business_pitch.
  about text,

  -- Trade ids from lib/agent-templates.ts ('roofing', 'plumbing', ...). This
  -- is what the matcher compares a post's trade against.
  trades text[] not null default '{}',
  -- Free text: the services they actually sell ("re-roofs, repairs, gutters").
  services text,
  years_experience smallint check (years_experience between 0 and 100),

  -- The "request": what jobs they want and which ones never to send them.
  wanted_jobs text,
  unwanted_jobs text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table company_profiles enable row level security;

drop policy if exists "company_profiles_select_own" on company_profiles;
drop policy if exists "company_profiles_insert_own" on company_profiles;
drop policy if exists "company_profiles_update_own" on company_profiles;
create policy "company_profiles_select_own" on company_profiles for select using (auth.uid() = user_id);
create policy "company_profiles_insert_own" on company_profiles for insert with check (auth.uid() = user_id);
create policy "company_profiles_update_own" on company_profiles for update using (auth.uid() = user_id);

-- Copy the current business settings across, once. A user who already has a
-- profile row keeps it. The settings keys stay where they are and the app
-- keeps writing them too, so rolling back the code loses nothing.
insert into company_profiles (user_id, business_name, owner_name, phone, about)
select user_id, business_name, owner_name, phone, about
from (
  select
    s.user_id,
    nullif(btrim(max(case when s.key = 'business_name' then s.value end)), '') as business_name,
    nullif(btrim(max(case when s.key = 'business_owner_name' then s.value end)), '') as owner_name,
    nullif(btrim(max(case when s.key = 'business_phone' then s.value end)), '') as phone,
    nullif(btrim(max(case when s.key = 'business_pitch' then s.value end)), '') as about
  from settings s
  where s.key in ('business_name', 'business_owner_name', 'business_phone', 'business_pitch')
  group by s.user_id
) legacy
where coalesce(business_name, owner_name, phone, about) is not null
on conflict (user_id) do nothing;

-- ── 3. client_service_areas ────────────────────────────────────────────────
create table if not exists client_service_areas (
  user_id uuid not null references auth.users(id) on delete cascade,
  area_id text not null references service_areas(id) on update cascade on delete cascade,
  -- Empty = the whole area. Otherwise only these cities (names from the
  -- area's own list), for a client who will not drive across the metro.
  cities text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (user_id, area_id)
);

create index if not exists client_service_areas_area_idx on client_service_areas (area_id);

alter table client_service_areas enable row level security;

drop policy if exists "client_service_areas_select_own" on client_service_areas;
drop policy if exists "client_service_areas_insert_own" on client_service_areas;
drop policy if exists "client_service_areas_update_own" on client_service_areas;
drop policy if exists "client_service_areas_delete_own" on client_service_areas;
create policy "client_service_areas_select_own" on client_service_areas for select using (auth.uid() = user_id);
create policy "client_service_areas_insert_own" on client_service_areas for insert with check (auth.uid() = user_id);
create policy "client_service_areas_update_own" on client_service_areas for update using (auth.uid() = user_id);
create policy "client_service_areas_delete_own" on client_service_areas for delete using (auth.uid() = user_id);

-- ── 4a. groups: which area, and who owns it ────────────────────────────────
alter table groups
  add column if not exists area_id text references service_areas(id) on update cascade on delete set null;

-- 'client' = a client's own source, seen only by them (everything today).
-- 'floozy' = collected by a Floozy account for everyone in its area. Step 4
-- shares posts from these groups with matching clients, so a client must not
-- be able to mark their own group as Floozy's: see the trigger below.
alter table groups
  add column if not exists owner_kind text not null default 'client';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'groups_owner_kind_check') then
    alter table groups add constraint groups_owner_kind_check check (owner_kind in ('client', 'floozy'));
  end if;
end $$;

create index if not exists groups_floozy_area_idx on groups (area_id) where owner_kind = 'floozy';

-- RLS lets a group's owner update every column, owner_kind included. Only a
-- request without a signed-in user (the service role, the SQL editor) may make
-- a group Floozy's or turn a Floozy group back.
create or replace function guard_group_owner_kind() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null
     and new.owner_kind is distinct from (case when tg_op = 'INSERT' then 'client' else old.owner_kind end)
  then
    raise exception 'owner_kind can only be changed by Floozy';
  end if;
  return new;
end $$;

drop trigger if exists groups_owner_kind_guard on groups;
create trigger groups_owner_kind_guard
  before insert or update of owner_kind on groups
  for each row execute function guard_group_owner_kind();

-- ── 4b. posts: what the classifier decided ─────────────────────────────────
-- All null until step 4 classifies a post. Classified once per post, not once
-- per client, which is what keeps the AI bill flat as clients are added.
alter table posts add column if not exists intent text;      -- 'request' | 'offer' | 'other'
alter table posts add column if not exists trade text;       -- a trade id from lib/agent-templates.ts
alter table posts add column if not exists city text;        -- as written in the post, if any
alter table posts add column if not exists area_id text references service_areas(id) on update cascade on delete set null;
alter table posts add column if not exists classified_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_intent_check') then
    alter table posts add constraint posts_intent_check check (intent is null or intent in ('request', 'offer', 'other'));
  end if;
end $$;

create index if not exists posts_area_trade_requests_idx
  on posts (area_id, trade, classified_at desc)
  where intent = 'request';
