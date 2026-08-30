-- ─────────────────────────────────────────────────────────────────────────
-- 0012: the public lead corpus behind the free scan
--
-- The free scan shows a stranger real requests for their trade in their city
-- before they have an account. That raises a question the pool cannot answer,
-- so this table exists to answer it separately.
--
-- Why not `pooled_opportunities`:
--
--   `pool_opt_in` is consent to share leads WITH OTHER CUSTOMERS. It is not
--   consent to display them to anonymous visitors on a marketing page. Those
--   are different audiences and a customer who agreed to the first has not
--   agreed to the second. Reusing that view for the scan would be a quiet
--   consent violation, and the fact that it would have worked technically is
--   exactly why it is worth writing down here.
--
-- So the scan reads only rows WE collected from public sources under our own
-- account — never a row that arrived through a customer's connected session.
-- Nothing in this table is attributable to a customer, which is what makes it
-- safe to show publicly.
--
-- The corollary: the free scan stays empty until an operator-run collector
-- fills this. That is correct behaviour, not a bug. An empty scan is honest;
-- a scan quietly serving somebody's private leads is not.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public_leads (
  id uuid primary key default gen_random_uuid(),

  -- Where we found it. 'reddit' | 'web' | 'craigslist' — whatever the
  -- collector used. Kept so a source that turns out to be low quality can be
  -- pulled without touching the rest.
  source text not null,

  -- The public post itself. Safe to store because it is already public, but
  -- deliberately NOT returned by the free scan — the URL is how you reach the
  -- person, and that is the thing the subscription is for.
  source_url text,

  -- Stable identifier from the source, so re-running the collector updates a
  -- row instead of duplicating it.
  external_id text not null,

  -- When the person actually posted, not when we found it. Recency is most of
  -- what makes a lead worth anything, and the two can differ by days.
  posted_at timestamptz not null,

  content text not null,

  -- Normalised, because the scan matches on them: 'roofing', 'plumbing', …
  -- and a lowercase city. Free-text here would make the lookup a guessing game.
  trade text not null,
  city text not null,
  region text,

  intent_score integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per post per source. Re-collection is an upsert, not a duplicate.
create unique index if not exists public_leads_source_external_idx
  on public_leads (source, external_id);

-- The shape the scan actually queries: this trade, this city, newest first.
create index if not exists public_leads_lookup_idx
  on public_leads (trade, city, posted_at desc);

-- Recency sweeps for expiry, independent of trade or city.
create index if not exists public_leads_posted_idx
  on public_leads (posted_at desc);

alter table public_leads enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- No policies, deliberately — not even for anon reads.
--
-- The obvious shortcut is a `for select using (true)` policy so the browser
-- can query this directly with the anon key. That would also hand anyone the
-- whole corpus, in bulk, at whatever rate they like: source URLs, every city,
-- every trade. The corpus is the product.
--
-- So reads go through /api/scan/preview on the service-role client, which
-- rate limits, caps the row count, and strips source_url before answering.
-- RLS with no policies is what makes that the only way in.
-- ─────────────────────────────────────────────────────────────────────────

comment on table public_leads is
  'Operator-collected public posts shown by the free scan. Never contains rows collected through a customer''s connected account — see 0012 header.';
