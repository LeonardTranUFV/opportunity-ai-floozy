-- ─────────────────────────────────────────────────────────────────────────
-- Remember that a source is behind a join wall.
--
-- The crawler already detects this. A group you have not joined does not
-- error: Facebook and LinkedIn serve a perfectly valid page with a join prompt
-- where the feed would be, so extraction finds nothing and it reports "found 0
-- posts" — indistinguishable from a real group where nobody needed a plumber
-- this week. lib/scraper.ts checks for the join button before accepting zero
-- as an answer, and says so in the run log.
--
-- But that log is transient. Nobody reads it, and the Communities page — the
-- one place a customer looks to ask "why is this source quiet?" — showed the
-- group as Active with 0 posts and no explanation. A source could sit there
-- for weeks looking healthy while being structurally incapable of collecting
-- anything.
--
-- So the finding gets persisted, and the UI can say the one thing that
-- actually fixes it: join the group.
--
-- Nullable with no default on purpose. NULL means "never checked", which is
-- honestly different from "checked, and you are a member" — a source added a
-- minute ago has not been visited yet, and claiming either way would be a
-- guess. The UI shows a badge only for the definite case.
-- ─────────────────────────────────────────────────────────────────────────

alter table groups
  add column if not exists needs_membership boolean;

-- When it was last established, so a stale answer can be told apart from a
-- fresh one. Facebook memberships change; a customer who joins a group should
-- see the badge clear on the next crawl rather than wonder why it persists.
alter table groups
  add column if not exists membership_checked_at timestamptz;

comment on column groups.needs_membership is
  'true = a join wall was seen where the feed should be, so this source cannot collect until the connected account joins. false = the feed was readable. null = not yet determined.';
