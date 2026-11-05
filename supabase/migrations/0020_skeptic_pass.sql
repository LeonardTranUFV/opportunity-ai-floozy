-- ─────────────────────────────────────────────────────────────────────────
-- The skeptic pass: a second AI check that tries to reject each lead the
-- scorer let through (lib/lead-skeptic.ts, lib/ai.ts skepticCheckLeads).
--
-- Only needed once SKEPTIC_MODE is set to "shadow" or "on". With the flag off
-- (the default) nothing reads or writes these columns, so the app keeps
-- working on a database that has not had this applied. Apply it first, then
-- switch the flag — the other order makes every scan's insert fail on an
-- unknown column.
--
-- All nullable: null means "not checked" (scored under the email line, the
-- flag was off, or the skeptic call failed), which counts as kept.
--
-- Safe to run more than once. Adds columns only; deletes nothing.
-- ─────────────────────────────────────────────────────────────────────────

alter table opportunities add column if not exists skeptic_verdict text;
alter table opportunities add column if not exists skeptic_code text;
alter table opportunities add column if not exists skeptic_reason text;
alter table opportunities add column if not exists skeptic_version text;
alter table opportunities add column if not exists skeptic_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'opportunities_skeptic_verdict_check'
  ) then
    alter table opportunities
      add constraint opportunities_skeptic_verdict_check
      check (skeptic_verdict is null or skeptic_verdict in ('keep', 'reject'));
  end if;
end $$;
