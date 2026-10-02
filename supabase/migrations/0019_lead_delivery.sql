-- ─────────────────────────────────────────────────────────────────────────
-- Who gets the morning leads, and when.
--
-- This already worked, but only on the operator's PC: lead-recipients.json
-- (gitignored) plus Task Scheduler running scripts/send-daily-leads.ts. That
-- means adding a client is editing a JSON file on one machine, nobody else can
-- see who is configured, and nothing goes out if that PC is asleep.
--
-- Moving the configuration into the database changes none of the selection
-- logic — lib/lead-digest.ts is the same rules the script used — it just puts
-- the list somewhere the app can edit and a scheduled job can read.
--
-- `send_hour` is an hour in `timezone`, not UTC, because "8 in the morning"
-- means the client's morning. The job runs every hour and asks each row
-- whether it is that row's hour yet, which is the only way one schedule can
-- serve clients in different places.
--
-- `last_sent_on` is a date in the same timezone, and is what stops a second
-- send: the job is idempotent per recipient per local day, so a retry, a
-- redeploy or an overlapping run cannot double-send.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists lead_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  -- Either may be empty, but not both — enforced below. Email is what the
  -- digest is actually sent to today; phone is stored for the record and for
  -- the SMS path, which is not built.
  email text,
  phone text,

  -- Which of this account's agents this client's leads come from. Empty means
  -- every agent on the account: a single-client operator should not have to
  -- maintain a list that is always "all of them".
  agent_ids uuid[] not null default '{}',

  -- 0-23, in `timezone`.
  send_hour smallint not null default 8,
  timezone text not null default 'America/Vancouver',

  active boolean not null default true,
  -- Local date of the last successful send. Null means never sent.
  last_sent_on date,
  last_result text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lead_recipients_hour_range check (send_hour between 0 and 23),
  constraint lead_recipients_has_a_destination check (
    coalesce(nullif(btrim(email), ''), nullif(btrim(phone), '')) is not null
  )
);

create index if not exists lead_recipients_user_idx on lead_recipients (user_id);
-- The scheduled job's own query: everything active, whatever the owner.
create index if not exists lead_recipients_due_idx on lead_recipients (active, send_hour);

alter table lead_recipients enable row level security;

create policy "lead_recipients_select_own" on lead_recipients
  for select using (auth.uid() = user_id);
create policy "lead_recipients_insert_own" on lead_recipients
  for insert with check (auth.uid() = user_id);
create policy "lead_recipients_update_own" on lead_recipients
  for update using (auth.uid() = user_id);
create policy "lead_recipients_delete_own" on lead_recipients
  for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- What has already been sent, so a lead goes out once.
--
-- The script kept this in logs/sent-leads.json next to itself. A file on one
-- PC cannot be read by a job running anywhere else, and the first thing that
-- happens when it is missing is every client receiving their whole backlog.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists lead_deliveries (
  recipient_id uuid not null references lead_recipients(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (recipient_id, opportunity_id)
);

alter table lead_deliveries enable row level security;

-- Readable by the owner of the recipient row; written only by the service
-- role, which is what the scheduled job uses.
create policy "lead_deliveries_select_own" on lead_deliveries
  for select using (
    exists (
      select 1 from lead_recipients r
      where r.id = lead_deliveries.recipient_id and r.user_id = auth.uid()
    )
  );
