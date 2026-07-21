-- Tracks whether a personalized outreach message has actually been sent
-- (posted as a comment / sent as a Messenger DM) for an opportunity.
alter table opportunities
  add column if not exists comment_sent_at timestamptz,
  add column if not exists dm_sent_at timestamptz;
