-- ─────────────────────────────────────────────────────────────────────────
-- Remove duplicate opportunities, and make the duplication impossible.
--
-- Measured on 2026-09-05: one agent held 706 opportunities for 223 distinct
-- asks. Two causes, both now fixed in code:
--
--   1. The "which posts has this agent already scored?" lookup was silently
--      truncated at PostgREST's 1,000-row default. Every post past the cap
--      was re-scored on every scan and minted another opportunity — 399 rows
--      shared an (agent_id, source_post_id) pair that is meant to be unique.
--
--   2. Facebook hands one story two ids depending on the payload shape, so
--      the same post was stored twice in `posts` and both copies were scored.
--
-- The code fixes stop new duplicates. This deletes the existing ones and adds
-- the constraint that should always have been there.
--
-- Which copy survives mirrors lib/dedupe-opportunities.ts, which the UI uses
-- to collapse the list until this has been run — so what a customer sees today
-- is exactly what they keep: anything they acted on (a status they set, an
-- outreach they sent) wins, then the copy with a profile link, then newest.
--
-- Safe to run more than once. Back up first if you want a way back: this
-- deletes rows.
-- ─────────────────────────────────────────────────────────────────────────

with ranked as (
  select
    id,
    row_number() over (
      partition by
        agent_id,
        lower(regexp_replace(coalesce(content, ''), '\s+', ' ', 'g'))
      order by
        case status
          when 'won'         then 6
          when 'proposal'    then 5
          when 'appointment' then 4
          when 'qualified'   then 3
          when 'contacted'   then 2
          when 'lost'        then 1
          else 0
        end desc,
        (comment_sent_at is not null or dm_sent_at is not null) desc,
        (author_profile_url is not null) desc,
        created_at desc
    ) as rn
  from opportunities
)
delete from opportunities
where id in (select id from ranked where rn > 1);

-- One post, one opportunity, per agent. NULL source_post_id (the legacy
-- import) is allowed to repeat, as Postgres unique indexes permit.
create unique index if not exists opportunities_agent_post_unique
  on opportunities (agent_id, source_post_id);

-- The same two-ids-one-post problem in `posts` itself: once the scraper
-- canonicalises Facebook ids, the older encoded duplicates are just dead
-- weight that the scan keeps re-reading. Keep the numeric-id copy where both
-- exist.
with dup_posts as (
  select
    id,
    row_number() over (
      partition by
        user_id,
        lower(regexp_replace(coalesce(raw_text, ''), '\s+', ' ', 'g'))
      order by
        -- prefer a plain numeric Facebook id over the encoded form
        (external_post_id ~ '^fb_[0-9]+$') desc,
        scraped_at desc
    ) as rn
  from posts
)
delete from posts
where id in (select id from dup_posts where rn > 1)
  -- never delete a post that an opportunity still points at
  and id not in (select source_post_id from opportunities where source_post_id is not null);
