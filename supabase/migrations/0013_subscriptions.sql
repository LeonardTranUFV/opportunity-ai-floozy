-- ─────────────────────────────────────────────────────────────────────────
-- 0013: what a customer has actually paid for
--
-- The obvious home for this was `settings`, which already stores per-user
-- key/value pairs and would have needed no migration at all. That would have
-- been a privilege escalation.
--
-- `settings` carries `settings_upsert_own` and `settings_update_own` policies,
-- so a signed-in user can write their own rows straight from the browser with
-- the anon key. Putting the plan there means any customer can award themselves
-- a subscription with one fetch call from the devtools console. The feature
-- would work perfectly in testing and be free to bypass in production.
--
-- So entitlement lives here instead, and the difference is the policy list
-- below: read your own row, and nothing else. No insert, no update, no delete
-- for anyone. Only the service-role client — which bypasses RLS and is only
-- ever used server-side — can write, and the only thing that writes is the
-- Stripe webhook.
--
-- Rule of thumb this encodes: a table the user can write is a table the user
-- controls. Anything money decides belongs somewhere they cannot reach.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists subscriptions (
  -- One subscription per account. The user id is the key because that is what
  -- /api/checkout attaches to the Stripe session as client_reference_id, and
  -- what the webhook reads back to know who paid.
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- Stripe's own identifiers, kept so a support question can be answered by
  -- looking one up rather than guessing from an email.
  stripe_customer_id text,
  stripe_subscription_id text,

  -- 'weekly' | 'monthly'. Null while trialing on a plan we no longer offer, or
  -- if Stripe sends a price we do not recognise — better null than a wrong guess.
  plan text,

  -- Stripe's own status string: trialing, active, past_due, canceled,
  -- incomplete, unpaid. Stored verbatim rather than collapsed to a boolean,
  -- because "past_due" and "canceled" need different handling and a boolean
  -- throws that away.
  status text not null default 'none',

  -- When the current period ends. What tells us a cancelled subscription is
  -- still owed service until the date they already paid for.
  current_period_end timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Answering "who is currently paying" without scanning the table.
create index if not exists subscriptions_status_idx on subscriptions (status);

-- Stripe sends subscription events keyed by its own id, not ours, so the
-- webhook has to be able to find the row that way too.
create index if not exists subscriptions_stripe_sub_idx on subscriptions (stripe_subscription_id);

alter table subscriptions enable row level security;

-- Read your own, and that is all. Deliberately no insert/update/delete policy
-- for any role: writes come from the service-role client in the webhook, which
-- bypasses RLS. See the header — this is the entire point of the table.
create policy "subscriptions_select_own" on subscriptions
  for select using (auth.uid() = user_id);

comment on table subscriptions is
  'Stripe entitlement, written only by the webhook via the service role. Users may read their own row and can never write one - see migration 0013.';
