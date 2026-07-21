-- Splits the single AI-generated reply into two separate drafts: a short
-- public comment and a more personal DM, since they serve different jobs
-- (comment = "we can help, check your DM"; DM = ask about the problem).
alter table opportunities
  add column if not exists suggested_comment text,
  add column if not exists suggested_dm text;
