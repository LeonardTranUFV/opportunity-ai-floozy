-- ─────────────────────────────────────────────────────────────────────────
-- 0014: who ran a free scan, and where to reach them
--
-- The free scan shows a stranger the first few leads and holds the links
-- back. To open them they either create an account or leave an email — and
-- that email is two things at once: how we deliver the leads they asked for,
-- and a prospect worth following up.
--
-- Kept apart from `public_leads` because it is personal data and the leads are
-- not. Different table, different retention, different rules.
--
-- Three decisions written down so they survive the next change:
--
--   1. **Email is required, phone is not.** A contractor gives an email to a
--      site they met a minute ago; a phone number they mostly do not. Making
--      both mandatory would trade a large share of captures for a field we can
--      ask for later, once there is a reason to trust us.
--
--   2. **Consent is stored, not assumed.** `consented_at` records that the
--      person ticked the line saying we may email them. CASL requires express
--      consent for commercial email in Canada, and "we had their address"
--      is not a defence. A row with a null `consented_at` may be used to
--      deliver the scan they asked for and nothing else.
--
--   3. **No policies at all.** These are our prospects, and one of them
--      reading the list would be reading every other contractor who tried the
--      product. Reads go through the service role, from the admin surface.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists scan_requests (
  id uuid primary key default gen_random_uuid(),

  email text not null,
  phone text,

  -- What they were looking for. Worth as much as the contact detail: it says
  -- which trade and which market to follow up about, and in aggregate it says
  -- which markets to fill the corpus for next.
  trade text not null,
  city text not null,

  -- How many results their scan actually found. A follow-up to someone whose
  -- scan returned nothing is a different conversation from one who saw twelve.
  results_found integer not null default 0,

  -- Null until they tick the box. See note 2 above.
  consented_at timestamptz,

  -- Set once we have actually emailed them the leads, so a retry or a second
  -- scan does not send twice.
  delivered_at timestamptz,

  -- If they later create an account, this links the prospect to the customer.
  user_id uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()
);

-- One row per person per trade+city. A second scan of the same thing updates
-- rather than duplicating, so the follow-up list stays a list of people.
create unique index if not exists scan_requests_unique_idx
  on scan_requests (lower(email), trade, city);

-- The two ways this gets read: newest prospects first, and "who asked about
-- this market".
create index if not exists scan_requests_created_idx on scan_requests (created_at desc);
create index if not exists scan_requests_market_idx on scan_requests (trade, city);

alter table scan_requests enable row level security;

-- Deliberately no policies. See note 3 — this is a prospect list, and it is
-- reachable only through the service-role client.

comment on table scan_requests is
  'Prospects captured by the free scan. Personal data: email required, phone optional, consent recorded separately from delivery - see migration 0014.';
