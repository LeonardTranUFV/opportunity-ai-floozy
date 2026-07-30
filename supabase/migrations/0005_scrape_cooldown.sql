-- Lets the scraper skip a group it already visited a few minutes ago instead
-- of re-scraping it on every single agent's "Scan for Opportunities" click
-- in the same session (previously: 4 agents scanned back-to-back meant the
-- same groups got scraped 4 times in a row).
alter table groups
  add column if not exists last_scraped_at timestamptz;
