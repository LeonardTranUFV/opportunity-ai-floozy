-- ─────────────────────────────────────────────────────────────────────────
-- 0015: a lead may have an unknown date
--
-- 0012 declared `posted_at` NOT NULL, written when the only source was Reddit's
-- feed, where every entry carries a timestamp. Search results do not: Google
-- returns "3 days ago" for some, an absolute date for others, and nothing at
-- all for many.
--
-- NOT NULL leaves two options for those, and both are wrong. Drop the lead —
-- throwing away good requests because the crawler could not read a date. Or
-- default it to now() — which silently tells a contractor that a two-year-old
-- post is fresh, on the single attribute they use to decide whether to answer.
--
-- So the column becomes nullable and null means "we do not know", which the
-- scan renders as unknown rather than guessing.
-- ─────────────────────────────────────────────────────────────────────────

alter table public_leads alter column posted_at drop not null;

comment on column public_leads.posted_at is
  'When the post was made, or null when the source did not say. Never defaulted to now() - see migration 0015.';
