/**
 * Which migrations are actually applied to production?
 *
 *   node scripts/check-migrations.mjs              # reads .env
 *   node scripts/check-migrations.mjs --env .env.worker
 *
 * Exists because there is no migration runner here. Files land in
 * supabase/migrations/ and somebody pastes them into the Supabase SQL editor
 * by hand, which means the repo and the database drift silently and the only
 * symptom is a 500 in production naming a table that does not exist. That
 * already happened once with 0012: the free scan was built, deployed, and
 * broken for weeks because nobody had run the migration behind it.
 *
 * Each migration gets a probe — the cheapest question whose answer proves it
 * ran. Some migrations cannot be checked over the REST API at all, and those
 * say so rather than guessing. A checker that reports a false PASS is worse
 * than no checker, because it is believed.
 *
 * Never prints a key and never writes anything.
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

const flag = process.argv.indexOf("--env");
const envFile = flag !== -1 ? process.argv[flag + 1] : ".env";
config({ path: path.resolve(projectRoot, envFile) });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey) {
  console.log(`FAIL  ${envFile} is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
  process.exit(1);
}

console.log(`database : ${new URL(url).host}`);
console.log(`env file : ${envFile}\n`);

/** One REST read as the service role. Returns { status, body, count }. */
async function ask(table, query = "select=*&limit=1", key = serviceKey) {
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.text().catch(() => "");
  const count = Number(res.headers.get("content-range")?.split("/")[1]);
  return { status: res.status, body, count: Number.isFinite(count) ? count : null };
}

/**
 * A read that succeeded.
 *
 * PostgREST answers a ranged request — which every `limit=` here is — with
 * **206 Partial Content**, not 200. Testing `status === 200` therefore failed
 * on the normal response, and four of the six probes below reported "could
 * not determine" against a database that had answered them perfectly well.
 * The checker could not see the two migrations that really are missing,
 * because it could not read the answer.
 */
const readOk = (status) => status === 200 || status === 206;

/** Does this table exist at all? A missing table is a 404 with PGRST205. */
async function tableExists(table) {
  const { status, body } = await ask(table, "select=*&limit=0");
  if (readOk(status)) return true;
  if (status === 404 || body.includes("PGRST205") || body.includes("does not exist")) return false;
  return null; // something else went wrong; do not guess
}

const results = [];
const record = (id, name, state, detail) => {
  results.push({ id, name, state, detail });
  const tag = { applied: "  ok  ", missing: " MISS ", unknown: "  ??  " }[state];
  console.log(`${tag} ${id}  ${name}`);
  if (detail) console.log(`       ${detail}`);
};

// ── 0012-0014: each creates a table, so existence is the whole question ─────
for (const [id, name, table] of [
  ["0012", "public_leads       ", "public_leads"],
  ["0013", "subscriptions      ", "subscriptions"],
  ["0014", "scan_requests      ", "scan_requests"],
]) {
  const exists = await tableExists(table);
  if (exists === true) {
    const { count } = await ask(table, "select=id&limit=0");
    record(id, name, "applied", `table present — ${count ?? "?"} rows`);
  } else if (exists === false) {
    record(id, name, "missing", `table "${table}" does not exist in this database`);
  } else {
    record(id, name, "unknown", "could not determine — unexpected response");
  }
}

// ── 0015: posted_at became nullable. Not visible over REST. ────────────────
// A null in the column proves it, but no nulls proves nothing, so this only
// ever upgrades to "applied" and otherwise admits it cannot tell.
{
  const exists = await tableExists("public_leads");
  if (exists !== true) {
    record("0015", "posted_at nullable ", "missing", "depends on 0012, which is not applied");
  } else {
    const { status, count } = await ask("public_leads", "select=id&posted_at=is.null&limit=0");
    if (readOk(status) && count > 0) {
      record("0015", "posted_at nullable ", "applied", `${count} rows already hold a null posted_at`);
    } else {
      record("0015", "posted_at nullable ", "unknown",
        "no null posted_at rows exist, which is not proof either way — check the column in the SQL editor");
    }
  }
}

// ── 0016: deleted two authorization keys out of `settings`. ────────────────
// This used to be reported as a live privilege-escalation path, and that
// wording is now wrong — which mattered, because the first person to run this
// checker read it and had to go and disprove it.
//
// The escalation was real while `lib/privileges.ts` read those rows out of
// `settings`, a table users may write to. It no longer does: admin and pool
// access come from ADMIN_EMAILS / ADMIN_USER_IDS / POOL_ACCESS_* in the
// environment, and nothing in lib/ or app/ reads the settings keys any more
// (verified 2026-09-10 — the only remaining mentions are comments). So rows
// left here are stale data, not access. Worth deleting; not worth alarm.
{
  const { status, count, body } = await ask(
    "settings",
    "select=key&key=in.(is_admin,pool_access)&limit=1"
  );
  if (!readOk(status)) {
    record("0016", "privileges out     ", "unknown", `settings query returned ${status}: ${body.slice(0, 80)}`);
  } else if (count === 0) {
    record("0016", "privileges out     ", "applied", "no is_admin / pool_access rows remain in settings");
  } else {
    record("0016", "privileges out     ", "missing",
      `${count} stale privilege row(s) in settings — inert (privileges come from env vars now), but delete them so nobody wires them up again`);
  }
}

// ── 0017: deleted duplicate opportunities. ────────────────────────────────
// The real check is a window function over normalised content, which REST
// cannot express. Reporting the row count is the honest half-answer.
{
  const { status, count } = await ask("opportunities", "select=id&limit=0");
  record("0017", "dedupe opportunities", "unknown",
    readOk(status)
      ? `${count ?? "?"} opportunities total — duplicate detection needs SQL; run the 0017 select in the editor to see if any remain`
      : `could not read opportunities (${status})`);
}

// ── The tables the scan reads must be closed to the browser ───────────────
// Same property that was verified for browser_sessions. The scan is served by
// the service role through /api/scan/preview; anon should never reach these
// directly, or the paywall is decoration.
if (anonKey) {
  console.log("\nanon (browser) access — these must all be refused:");
  for (const table of ["public_leads", "subscriptions", "scan_requests"]) {
    const { status, body } = await ask(table, "select=*&limit=1", anonKey);
    /**
     * The status alone does not answer this, and reading it that way made the
     * checker cry wolf on the *secure* case.
     *
     * RLS enabled with no policy for anon is not a 403. PostgREST applies the
     * policy as a filter and returns **200 with `[]`** — the request is
     * allowed, every row is invisible. So a bare `status === 200` flagged all
     * three tables as "anon can READ this", when in fact none of them returned
     * a single row. A security check that warns on the correct configuration
     * gets ignored, and then it is not a security check.
     *
     * What actually distinguishes them is the body: rows came back, or they
     * did not.
     */
    const closed = status === 401 || status === 403 || status === 404;
    let rows = null;
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) rows = parsed.length;
    } catch {
      // Not JSON — fall through to "??" rather than guess.
    }
    const leaks = status === 200 && rows !== null && rows > 0;
    const filtered = status === 200 && rows === 0;
    console.log(
      `${closed || filtered ? "  ok  " : leaks ? " WARN " : "  ??  "} ${table.padEnd(16)} ${status}` +
        (filtered ? "  — 200 with no rows: RLS refused everything, which is correct" : "") +
        (leaks ? `  — anon READ returned ${rows} row(s); confirm that is intended` : "")
    );
  }
} else {
  console.log("\n(no anon key in this env file — skipped the browser-access check)");
}

const missing = results.filter((r) => r.state === "missing");
const unknown = results.filter((r) => r.state === "unknown");

console.log("");
if (missing.length === 0) {
  console.log(`PASS — nothing is provably missing. ${unknown.length} migration(s) could not be checked from here.`);
} else {
  console.log(`FAIL — ${missing.length} migration(s) not applied.\n`);
  console.log("Apply them in order, in the Supabase SQL editor:");
  for (const m of missing) console.log(`  supabase/migrations/${m.id}_*.sql`);
}
process.exit(missing.length === 0 ? 0 : 1);
