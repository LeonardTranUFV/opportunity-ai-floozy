-- Per-agent auto-scan schedule. NULL = auto-scan off (the default — scanning
-- stays manual unless the user opts an agent in). When set, the cron route
-- at /api/cron/auto-scan re-evaluates fresh posts for this agent every N
-- hours without the user having to click "Scan for Opportunities" themselves.
alter table agents
  add column if not exists auto_scan_interval_hours integer,
  add column if not exists last_auto_scan_at timestamptz;

alter table agents drop constraint if exists agents_auto_scan_interval_check;
alter table agents
  add constraint agents_auto_scan_interval_check
  check (auto_scan_interval_hours is null or auto_scan_interval_hours in (1, 4, 12));
