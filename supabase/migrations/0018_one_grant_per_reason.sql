-- ─────────────────────────────────────────────────────────────────────────
-- One grant per reason, enforced by the database.
--
-- `ensureTrialCredits` and `ensurePlanCredits` (lib/credits.ts) both look for
-- the grant's own transaction row and grant when they do not find it. That is
-- check-then-act, and both run on every authenticated page render — see
-- app/(app)/layout.tsx — so two tabs opening together, or a prefetch racing the
-- click that caused it, can both read "not granted yet" and both grant. The
-- window is milliseconds; the prize is a second plan allowance, repeatable
-- every billing period.
--
-- No amount of care in the application closes that, because the check and the
-- write are two statements from two connections. Postgres can: the loser's
-- insert fails, `adjust_credits` rolls back the balance with it (0008 does the
-- update and the row in one function), and both callers already treat a failed
-- grant as "not granted" and carry on — the page renders, the next one retries,
-- and by then the row exists.
--
-- Scoped to the grants that are meant to happen exactly once:
--
--   trial_grant        the welcome credits, one per account, ever
--   plan_grant:<plan>:<period end>
--                      one per billing period; the period is in the reason, so
--                      a renewal is a different reason and grants again
--
-- Top-ups are deliberately repeatable — somebody can buy two packs in a day —
-- so theirs is keyed on the Stripe checkout session instead, which is the thing
-- that must never be honoured twice. That is also what the webhook checks
-- before granting; this makes the check binding rather than advisory.
--
-- Safe to run more than once. It will refuse if duplicates already exist, which
-- means a race has already happened; this finds them:
--
--   select user_id, reason, count(*), sum(amount)
--     from credit_transactions
--    where reason = 'trial_grant' or reason like 'plan_grant:%'
--    group by user_id, reason
--   having count(*) > 1;
-- ─────────────────────────────────────────────────────────────────────────

create unique index if not exists credit_transactions_one_grant_per_reason
  on credit_transactions (user_id, reason)
  where reason = 'trial_grant' or reason like 'plan_grant:%';

create unique index if not exists credit_transactions_one_grant_per_session
  on credit_transactions ((metadata ->> 'session_id'))
  where reason = 'top_up_purchase';

comment on index credit_transactions_one_grant_per_reason is
  'A grant that is meant to happen once cannot happen twice, whatever two concurrent renders decide. See lib/credits.ts ensureTrialCredits / ensurePlanCredits.';
