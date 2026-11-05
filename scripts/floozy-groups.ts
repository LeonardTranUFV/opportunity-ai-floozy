// Floozy's area groups: the Facebook groups Floozy's own accounts read for
// every client in an area (step 3 of the shared-leads plan).
//
//   npx tsx scripts/floozy-groups.ts setup --user <uuid> [--env .env.worker]
//       Marks an account as a Floozy collector's: Facebook is then never read
//       for it from the cloud. Add the same id to FLOOZY_COLLECTOR_USER_IDS
//       in .env.worker and in Vercel, then sign its Facebook profile in on
//       this PC with scripts/local-login.ts.
//
//   npx tsx scripts/floozy-groups.ts load floozy-groups.local.json [--dry-run]
//       Adds or updates area groups from a local file (see
//       floozy-groups.example.json). The real file is gitignored: the
//       repository is public, and a group list is Floozy's own work.
//
//   npx tsx scripts/floozy-groups.ts list
//       Groups per area: public / private, when last read, posts in 24 h.
//
// Writes with the service role, which is the only role allowed to mark a
// group as Floozy's (see the trigger in migration 0021).

import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { floozyCollectorIds, parseAreaGroupFile } from "@/lib/floozy-collect";
import { SERVICE_AREAS } from "@/lib/service-areas";
import { COLLECTION_MODE_KEY } from "@/lib/collection-mode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const envFile = arg("env") ?? ".env.worker";
const loaded = config({ path: path.resolve(projectRoot, envFile) });
if (loaded.error) {
  console.error(`[floozy-groups] could not read ${envFile}: ${loaded.error.message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`[floozy-groups] ${envFile} is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function setup() {
  const user = (arg("user") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(user)) {
    console.error("[floozy-groups] setup needs --user <uuid> (the collector account's id, from Supabase → Authentication).");
    process.exit(1);
  }
  const { data, error } = await supabase.auth.admin.getUserById(user);
  if (error || !data?.user) {
    console.error(`[floozy-groups] no account with id ${user}.`);
    process.exit(1);
  }
  const { error: upError } = await supabase
    .from("settings")
    .upsert({ user_id: user, key: COLLECTION_MODE_KEY, value: "local:facebook" }, { onConflict: "user_id,key" });
  if (upError) {
    console.error(`[floozy-groups] could not save: ${upError.message}`);
    process.exit(1);
  }
  const listed = floozyCollectorIds().includes(user);
  console.log(`[floozy-groups] ${user}: Facebook is now read only from this PC for this account.`);
  console.log(
    listed
      ? "  It is already in FLOOZY_COLLECTOR_USER_IDS here. Make sure Vercel has the same list."
      : "  Next: add it to FLOOZY_COLLECTOR_USER_IDS in .env.worker and in Vercel (comma-separated)."
  );
  console.log(`  Then sign its Facebook in on this PC:\n  npx tsx scripts/local-login.ts --env ${envFile} --platform facebook --user ${user}`);
}

async function load() {
  const file = process.argv[3];
  if (!file || file.startsWith("--")) {
    console.error("[floozy-groups] load needs a file, e.g. floozy-groups.local.json");
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(path.resolve(process.cwd(), file), "utf8"));
  const collectors = floozyCollectorIds();
  const { groups, problems } = parseAreaGroupFile(raw, collectors, new Set(SERVICE_AREAS.map((a) => a.id)));
  if (problems.length) {
    console.error(`[floozy-groups] ${problems.length} problem(s) in ${file}, nothing written:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const rows = groups.map((g) => ({
    user_id: g.collector,
    platform: "facebook",
    name: g.name,
    url: g.url,
    active: true,
    owner_kind: "floozy",
    area_id: g.area,
    access: g.access,
  }));
  const perArea = new Map<string, { pub: number; priv: number }>();
  for (const g of groups) {
    const c = perArea.get(g.area) ?? { pub: 0, priv: 0 };
    if (g.access === "public") c.pub++;
    else c.priv++;
    perArea.set(g.area, c);
  }
  for (const [area, c] of perArea) console.log(`  ${area}: ${c.pub} public, ${c.priv} private`);

  if (process.argv.includes("--dry-run")) {
    console.log(`[floozy-groups] dry run: ${rows.length} group(s) checked, nothing written.`);
    return;
  }
  const { error, count } = await supabase.from("groups").upsert(rows, { onConflict: "user_id,url", count: "exact" });
  if (error) {
    console.error(`[floozy-groups] write failed (are migrations 0021 and 0022 applied?): ${error.message}`);
    process.exit(1);
  }
  console.log(`[floozy-groups] ${count ?? rows.length} area group(s) added or updated.`);
}

async function list() {
  const collectors = floozyCollectorIds();
  if (collectors.length === 0) {
    console.log("[floozy-groups] FLOOZY_COLLECTOR_USER_IDS is empty.");
    return;
  }
  const { data: groups, error } = await supabase
    .from("groups")
    .select("id, user_id, name, area_id, access, active, last_scraped_at, needs_membership")
    .eq("owner_kind", "floozy")
    .in("user_id", collectors)
    .order("area_id");
  if (error) {
    console.error(`[floozy-groups] ${error.message}`);
    process.exit(1);
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: runs } = await supabase.from("collector_runs").select("group_id, posts_new, items, source").gte("started_at", since);
  const newByGroup = new Map<string, number>();
  let apifyItems = 0;
  for (const r of runs ?? []) {
    if (r.group_id) newByGroup.set(r.group_id, (newByGroup.get(r.group_id) ?? 0) + (r.posts_new ?? 0));
    if (r.source === "apify") apifyItems += r.items ?? 0;
  }

  let area = "";
  for (const g of groups ?? []) {
    if (g.area_id !== area) {
      area = g.area_id ?? "(no area)";
      console.log(`\n${area}`);
    }
    const last = g.last_scraped_at ? `${Math.round((Date.now() - Date.parse(g.last_scraped_at)) / 3_600_000)}h ago` : "never";
    const flags = [g.access ?? "access?", g.active ? "" : "paused", g.needs_membership ? "NEEDS JOIN" : ""].filter(Boolean).join(", ");
    console.log(`  ${g.name.slice(0, 50).padEnd(50)} ${flags.padEnd(22)} read ${last.padEnd(9)} +${newByGroup.get(g.id) ?? 0} in 24h  [${g.user_id.slice(0, 8)}]`);
  }
  console.log(`\n${groups?.length ?? 0} area group(s). Apify results in the last 24h: ${apifyItems}.`);
}

const command = process.argv[2];
const run = command === "setup" ? setup : command === "load" ? load : command === "list" ? list : null;
if (!run) {
  console.error("Usage: npx tsx scripts/floozy-groups.ts setup --user <uuid> | load <file.json> [--dry-run] | list   [--env .env.worker]");
  process.exit(1);
}
run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[floozy-groups] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
