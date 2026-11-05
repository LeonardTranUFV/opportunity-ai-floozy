/**
 * Floozy collects leads per area with its own accounts (step 3 of the
 * shared-leads plan), so clients never have to connect Facebook.
 *
 * ── Collectors ─────────────────────────────────────────────────────────────
 *
 * A collector is an ordinary account in this app, owned by Floozy, listed in
 * FLOOZY_COLLECTOR_USER_IDS. One per Floozy Facebook profile: the session
 * code keys a login by (account, platform), so a second Facebook profile is a
 * second account rather than a new kind of session. Area groups belong to a
 * collector (groups.owner_kind = 'floozy', which only the service role can set,
 * see migration 0021), and their posts are stored under that collector until
 * the matcher (step 4) hands them to clients.
 *
 * ── Two ways in ────────────────────────────────────────────────────────────
 *
 *   public groups   Apify, from the hosted cron (/api/cron/collect-areas).
 *                   No Facebook login, so no account at risk. Billed per
 *                   result, so there is a daily cap.
 *   private groups  the PC worker (scripts/auto-scrape.ts), signed in as the
 *                   collector's Facebook profile on the home connection, a
 *                   few groups per run, each at most every few hours.
 *
 * Group lists themselves are never committed (the repository is public): they
 * are loaded from a local file by scripts/floozy-groups.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { scrapeGroupsViaApify } from "@/lib/apify-scraper";
import { storeScrapedPosts } from "@/lib/store-posts";

type Env = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The collector accounts, in the order given. Anything that is not a uuid is ignored. */
export function floozyCollectorIds(env: Env = process.env): string[] {
  return [
    ...new Set(
      (env.FLOOZY_COLLECTOR_USER_IDS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => UUID.test(s))
    ),
  ];
}

const num = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && raw !== undefined && raw.trim() !== "" ? Math.min(max, Math.max(min, n)) : fallback;
};

export interface CollectSettings {
  /** Apify: results allowed per UTC day, across every area. */
  apifyDailyResults: number;
  /** Apify: results asked for per group per read. */
  apifyResultsPerGroup: number;
  /** Apify: don't re-read a public group sooner than this. */
  apifyMinAgeMs: number;
  /** Apify: only posts from the last N days. */
  apifySinceDays: number;
  /** PC: private groups read per collector per worker run. */
  pcGroupsPerRun: number;
  /** PC: don't re-read a private group sooner than this. */
  pcMinAgeMs: number;
}

export function collectSettings(env: Env = process.env): CollectSettings {
  const hour = 60 * 60 * 1000;
  return {
    apifyDailyResults: num(env.APIFY_DAILY_RESULTS, 1000, 0, 100_000),
    apifyResultsPerGroup: num(env.APIFY_RESULTS_PER_GROUP, 25, 1, 500),
    apifyMinAgeMs: num(env.APIFY_GROUP_MIN_AGE_HOURS, 6, 1, 168) * hour,
    apifySinceDays: num(env.APIFY_SINCE_DAYS, 3, 1, 30),
    pcGroupsPerRun: num(env.FLOOZY_PC_GROUPS_PER_RUN, 6, 1, 50),
    pcMinAgeMs: num(env.FLOOZY_PC_GROUP_MIN_AGE_HOURS, 8, 1, 168) * hour,
  };
}

export interface DueCandidate {
  id: string;
  last_scraped_at: string | null;
}

/** Groups not read within `minAgeMs`, never-read first, then stalest first, at most `limit`. */
export function pickDueGroups<T extends DueCandidate>(groups: T[], now: number, minAgeMs: number, limit: number): T[] {
  const at = (g: T) => (g.last_scraped_at ? Date.parse(g.last_scraped_at) : Number.NEGATIVE_INFINITY);
  return groups
    .filter((g) => {
      const t = at(g);
      return !Number.isFinite(t) || now - t >= minAgeMs;
    })
    .sort((a, b) => at(a) - at(b))
    .slice(0, Math.max(0, limit));
}

/** How many results the next Apify read may ask for: 0 means the day's cap is spent. */
export function apifyAllowance(usedToday: number, dailyCap: number, perGroup: number): number {
  return Math.max(0, Math.min(perGroup, dailyCap - usedToday));
}

export function utcDayStart(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

interface AreaGroupRow {
  id: string;
  user_id: string;
  platform: string;
  name: string;
  url: string;
  area_id: string | null;
  last_scraped_at: string | null;
}

export interface AreaCollectResult {
  skipped?: string;
  groupsRead: number;
  items: number;
  postsNew: number;
  usedToday: number;
  cap: number;
  log: string[];
}

/** Records one read. Never throws: a missing log must not lose the posts. */
export async function logCollectorRun(
  supabase: SupabaseClient,
  row: {
    source: "apify" | "pc";
    group_id: string;
    collector_id: string;
    area_id: string | null;
    started_at: string;
    items: number;
    posts_new: number;
    error?: string | null;
  }
): Promise<void> {
  try {
    await supabase.from("collector_runs").insert({ ...row, finished_at: new Date().toISOString() });
  } catch {
    // collector_runs missing (0022 not applied) is reported by the caller's
    // usage read; nothing to add here.
  }
}

/**
 * Reads Floozy's public area groups through Apify, stalest first, until the
 * time budget or the day's result cap runs out. Service-role client only.
 */
export async function collectPublicAreaGroups(
  supabase: SupabaseClient,
  opts: { budgetMs: number; env?: Env; now?: number }
): Promise<AreaCollectResult> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  const s = collectSettings(env);
  const result: AreaCollectResult = { groupsRead: 0, items: 0, postsNew: 0, usedToday: 0, cap: s.apifyDailyResults, log: [] };

  const collectors = floozyCollectorIds(env);
  if (collectors.length === 0) return { ...result, skipped: "FLOOZY_COLLECTOR_USER_IDS is not set" };
  if (!env.APIFY_TOKEN) return { ...result, skipped: "APIFY_TOKEN is not set" };

  const { data: runs, error: runsError } = await supabase
    .from("collector_runs")
    .select("items")
    .eq("source", "apify")
    .gte("started_at", utcDayStart(now));
  if (runsError) {
    // Without the log the cap cannot be counted, and an uncounted cap is no cap.
    return { ...result, skipped: `can't read collector_runs (is migration 0022 applied?): ${runsError.message}` };
  }
  result.usedToday = (runs ?? []).reduce((sum, r) => sum + (r.items ?? 0), 0);

  const { data: groups, error } = await supabase
    .from("groups")
    .select("id, user_id, platform, name, url, area_id, last_scraped_at")
    .eq("owner_kind", "floozy")
    .eq("access", "public")
    .eq("platform", "facebook")
    .eq("active", true)
    .in("user_id", collectors);
  if (error) return { ...result, skipped: `can't read area groups: ${error.message}` };

  const due = pickDueGroups((groups ?? []) as AreaGroupRow[], now, s.apifyMinAgeMs, 500);
  if (due.length === 0) return { ...result, skipped: "no public area group is due" };

  const deadline = Date.now() + opts.budgetMs;
  for (const g of due) {
    const allowance = apifyAllowance(result.usedToday, s.apifyDailyResults, s.apifyResultsPerGroup);
    if (allowance === 0) {
      result.log.push(`Daily Apify cap reached (${result.usedToday}/${s.apifyDailyResults} results). The rest wait for tomorrow.`);
      break;
    }
    const remaining = deadline - Date.now();
    if (remaining < 60_000) {
      result.log.push(`Out of time before "${g.name}". It is first in line next run.`);
      break;
    }

    const startedAt = new Date().toISOString();
    const summary = await scrapeGroupsViaApify(
      [{ id: g.id, platform: g.platform, name: g.name, url: g.url }],
      { budgetMs: Math.min(remaining - 15_000, 330_000), sinceDays: s.apifySinceDays, resultsLimit: allowance }
    );
    result.log.push(...summary.log);

    const read = summary.scrapedGroupIds.includes(g.id);
    // Apify bills for what it returned; mapped posts are at most that. When it
    // failed, count the allowance as spent rather than nothing, so repeated
    // failures cannot run up an uncounted bill.
    const items = read ? summary.itemsReturned : allowance;
    let postsNew = 0;
    let runError: string | null = read ? null : summary.log[summary.log.length - 1] ?? "failed";

    if (read) {
      const stored = await storeScrapedPosts(supabase, g.user_id, summary.posts, new Map([[g.id, g.area_id]]));
      postsNew = stored.inserted;
      if (stored.errors.length) runError = stored.errors.join("; ");
      await supabase.from("groups").update({ last_scraped_at: new Date().toISOString() }).eq("id", g.id);
      result.groupsRead++;
    }

    result.items += items;
    result.usedToday += items;
    result.postsNew += postsNew;
    await logCollectorRun(supabase, {
      source: "apify",
      group_id: g.id,
      collector_id: g.user_id,
      area_id: g.area_id,
      started_at: startedAt,
      items,
      posts_new: postsNew,
      error: runError,
    });
  }

  return result;
}

export interface AreaGroupInput {
  url: string;
  name: string;
  area: string;
  access: "public" | "private";
  collector: string;
}

/**
 * Checks a local area-group list (scripts/floozy-groups.ts load) before
 * anything is written. Every problem is listed, so one run fixes the file.
 * A missing collector means the first one; a missing name means the URL.
 */
export function parseAreaGroupFile(
  raw: unknown,
  collectors: string[],
  areaIds: ReadonlySet<string>
): { groups: AreaGroupInput[]; problems: string[] } {
  const problems: string[] = [];
  const groups: AreaGroupInput[] = [];
  if (!Array.isArray(raw)) return { groups, problems: ["The file must be a JSON list of groups."] };
  if (collectors.length === 0) problems.push("FLOOZY_COLLECTOR_USER_IDS is empty, so nobody can own these groups.");

  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const at = `#${i + 1}`;
    if (!entry || typeof entry !== "object") {
      problems.push(`${at}: not an object.`);
      return;
    }
    const e = entry as Record<string, unknown>;
    const url = typeof e.url === "string" ? e.url.trim() : "";
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed || !/(^|\.)facebook\.com$/i.test(parsed.hostname) || !/^\/groups\/[^/]+/.test(parsed.pathname)) {
      problems.push(`${at}: "${url}" is not a facebook.com/groups/... link.`);
      return;
    }
    const clean = `https://www.facebook.com${parsed.pathname.replace(/\/+$/, "")}`;
    if (seen.has(clean)) {
      problems.push(`${at}: ${clean} is listed twice.`);
      return;
    }
    seen.add(clean);

    const area = typeof e.area === "string" ? e.area.trim() : "";
    if (!areaIds.has(area)) problems.push(`${at}: unknown area "${area}" (use an id like metro-vancouver).`);
    const access = e.access === "public" || e.access === "private" ? e.access : null;
    if (!access) problems.push(`${at}: access must be "public" or "private".`);
    const collector = typeof e.collector === "string" && e.collector.trim() ? e.collector.trim().toLowerCase() : collectors[0];
    if (collector && !collectors.includes(collector)) problems.push(`${at}: collector ${collector} is not in FLOOZY_COLLECTOR_USER_IDS.`);
    const name = typeof e.name === "string" && e.name.trim() ? e.name.trim().slice(0, 200) : clean;

    if (access && areaIds.has(area) && collector && collectors.includes(collector)) {
      groups.push({ url: clean, name, area, access, collector });
    }
  });
  return { groups, problems };
}
