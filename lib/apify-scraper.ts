import type { GroupToScrape, ScrapeSummary, ScrapedPost } from "@/lib/scraper";

/**
 * Collecting Facebook group posts through Apify, instead of through a browser
 * we drive ourselves.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The rented-browser path works, and it carries two costs this one does not.
 *
 * The first is maintenance. Every extractor in lib/scraper.ts is a bet on
 * Facebook's markup, and we have lost that bet twice in a fortnight: comments
 * were being stored as posts because `div[role="article"]` is also a comment,
 * and absolute dates never parsed because the aria-label leads with a weekday
 * and both patterns were anchored with ^. Each cost real leads and each was
 * found by hand. A hosted actor is somebody else's job to keep working.
 *
 * The second is the account. The browser path reads the feed signed in as a
 * customer, which puts their login on the line. Apify's Facebook actors read
 * *public* groups with no credentials at all — so for a public source there is
 * no account to lose. Private groups still need a member's cookie, and this
 * module deliberately does not accept one: if a source needs a login, it stays
 * on the browser path where the session handling already lives.
 *
 * ── What this is not ───────────────────────────────────────────────────────
 *
 * Not a replacement, and not wired into scrapeAndStorePosts. It returns the
 * same ScrapeSummary as scrapeActiveGroups so the two can be run over the same
 * group list and compared (scripts/compare-apify.ts) before anything is
 * switched. Choosing between them is a decision to take with numbers in hand.
 */

/** Per-run cost of the sync endpoint: Apify returns 408 past 300 seconds. */
const APIFY_MAX_SYNC_SECONDS = 300;

/**
 * What one group's run is assumed to cost before we have measured one, used to
 * decide whether there is time to start another. Deliberately pessimistic —
 * overrunning the caller's budget is worse than reading one fewer source,
 * since whatever is skipped is picked up next run anyway.
 */
const PER_GROUP_FLOOR_MS = 45_000;

/**
 * The actor to run, and the field it expects its URLs under.
 *
 * Both are env-overridable because Apify is a marketplace, not an API: actors
 * differ in input shape, in output field names, and in price per 1,000 results
 * by roughly two orders of magnitude. Swapping one for another must not need a
 * deploy, and A/B-ing two actors against the same groups is the only honest way
 * to find out which one actually returns usable posts for our sources.
 */
const ACTOR_ID = process.env.APIFY_FACEBOOK_ACTOR || "apify~facebook-groups-scraper";
const URL_FIELD = process.env.APIFY_FACEBOOK_URL_FIELD || "startUrls";

export interface ApifyScrapeOptions {
  /** Wall-clock budget for the whole pass, matching scrapeActiveGroups. */
  budgetMs?: number;
  /** Only return posts newer than this many days. Maps to the actor's date filter. */
  sinceDays?: number;
  /** Posts per group. Kept low by default: these are priced per result. */
  resultsLimit?: number;
}

/** True when a token is configured, so callers can skip the pass entirely. */
export function isApifyConfigured(): boolean {
  return !!process.env.APIFY_TOKEN;
}

/**
 * Reads whichever of several field names an actor happened to use.
 *
 * Every Facebook actor on the marketplace returns the same facts under
 * different keys — `text` or `message` or `postText`, `time` or `timestamp` or
 * `publishedAt`. Rather than pin this module to one actor's schema, each field
 * lists the spellings seen in the wild and takes the first that is present.
 * An actor whose shape is not covered here fails loudly at the mapping stage,
 * which is the right place to find out.
 */
function firstString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = key.includes(".")
      ? key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], item)
      : item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * An actor's timestamp, as an ISO string, or null when it did not give one.
 *
 * Null is a real answer and must stay distinguishable from a guess: lib/post-age.ts
 * shows a post with no date differently ("seen 5d ago", muted, with a tooltip)
 * precisely so a scrape date is never passed off as a post date. Falling back
 * to Date.now() here would defeat that at the source.
 */
function toIsoOrNull(raw: string | null): string | null {
  if (!raw) return null;
  // Unix seconds and milliseconds both appear; both are plausible dates, so
  // the magnitude decides rather than the field name.
  if (/^\d{9,13}$/.test(raw)) {
    const n = Number(raw);
    const ms = raw.length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapItem(item: Record<string, unknown>, group: GroupToScrape): ScrapedPost | null {
  const text = firstString(item, ["text", "message", "postText", "content", "description"]);
  // A post with no text cannot be scored, so it is dropped here rather than
  // stored and filtered later — the same rule the DOM extractors apply.
  if (!text) return null;

  const postUrl = firstString(item, ["url", "postUrl", "link", "topLevelUrl", "facebookUrl"]);
  const externalId =
    firstString(item, ["postId", "id", "facebookId", "legacyId", "post_id"]) ??
    // Falling back to the URL keeps dedupe working on actors that return no id
    // of their own. lib/dedupe-opportunities.ts collapses the rest.
    postUrl;
  if (!externalId) return null;

  return {
    group_id: group.id,
    platform: group.platform,
    external_post_id: externalId,
    post_url: postUrl,
    author_name:
      firstString(item, ["user.name", "author.name", "authorName", "ownerName", "userName"]) ??
      "Unknown",
    author_profile_url: firstString(item, [
      "user.profileUrl",
      "user.url",
      "author.url",
      "authorProfileUrl",
      "profileUrl",
    ]),
    posted_at: toIsoOrNull(
      firstString(item, ["time", "timestamp", "date", "publishedAt", "publishTime", "createdAt"])
    ),
    raw_text: text,
  };
}

async function runActorForGroup(
  group: GroupToScrape,
  token: string,
  opts: Required<Pick<ApifyScrapeOptions, "sinceDays" | "resultsLimit">>,
  timeoutSeconds: number
): Promise<Record<string, unknown>[]> {
  const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString().slice(0, 10);

  const input: Record<string, unknown> = {
    [URL_FIELD]: [{ url: group.url }],
    resultsLimit: opts.resultsLimit,
    // Both spellings are sent because actors disagree on the name and ignore
    // keys they do not know. Asking for recent posts is the whole point: we
    // are billed per result, and a lead from six months ago is not a lead.
    onlyPostsNewerThan: since,
    startDate: since,
    sortBy: "CHRONOLOGICAL",
  };

  // The token goes in the Authorization header, never the query string — a URL
  // ends up in logs, in error messages, and in anything that records an
  // outbound request.
  const res = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}/run-sync-get-dataset-items?timeout=${timeoutSeconds}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((timeoutSeconds + 15) * 1000),
    }
  );

  if (res.status === 408) {
    throw new Error(
      `the actor was still running after ${timeoutSeconds}s — lower resultsLimit, or run this group on its own`
    );
  }
  if (!res.ok) {
    // Apify puts the useful part in a JSON error body; the status alone does
    // not distinguish a bad token from a bad actor id from a bad input field.
    const body = await res.text().catch(() => "");
    throw new Error(`Apify returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  const items = await res.json();
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

/**
 * Reads a set of Facebook groups through Apify.
 *
 * Returns the same shape as scrapeActiveGroups, including the log lines, so a
 * caller can swap one for the other. One run per group rather than one run for
 * all of them: actors vary in whether they echo back which group an item came
 * from, and guessing that wrong attributes somebody's leads to the wrong
 * source. A run per group costs more HTTP calls and no more results, since
 * Apify bills per result either way.
 */
export async function scrapeGroupsViaApify(
  groups: GroupToScrape[],
  options: ApifyScrapeOptions = {}
): Promise<ScrapeSummary> {
  const log: string[] = [];
  const posts: ScrapedPost[] = [];
  const scrapedGroupIds: string[] = [];

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return {
      posts,
      log: ["Apify skipped: APIFY_TOKEN is not set."],
      scrapedGroupIds,
      joinWalledGroupIds: [],
      brokenPlatforms: [],
    };
  }

  const budgetMs = options.budgetMs ?? 120_000;
  const sinceDays = options.sinceDays ?? 7;
  const resultsLimit = options.resultsLimit ?? 100;
  const deadline = Date.now() + budgetMs;

  let slowestGroupMs = 0;
  let mappedNothing = 0;

  for (const group of groups) {
    // Stop before starting a run that cannot finish, rather than discovering it
    // by being killed — the same rule the scan loop follows in scan-agent.ts.
    const expected = Math.max(PER_GROUP_FLOOR_MS, slowestGroupMs);
    if (Date.now() + expected > deadline) {
      log.push(`Stopped before "${group.name}" — out of time. It is first in line next run.`);
      break;
    }

    const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);
    const timeoutSeconds = Math.max(30, Math.min(APIFY_MAX_SYNC_SECONDS, remainingSeconds));
    const startedAt = Date.now();

    try {
      const items = await runActorForGroup(group, token, { sinceDays, resultsLimit }, timeoutSeconds);
      const mapped = items.map((item) => mapItem(item, group)).filter((p): p is ScrapedPost => !!p);

      // Items returned but none mapped means the actor's output shape is not
      // one firstString() knows. That is a configuration problem, not a quiet
      // week, and it must not read like one — see diagnosePlatform() for the
      // same distinction on the browser path.
      if (items.length > 0 && mapped.length === 0) {
        mappedNothing++;
        log.push(
          `"${group.name}": ${items.length} item(s) returned but none had a readable post — the actor's field names are not recognised. Check APIFY_FACEBOOK_ACTOR.`
        );
      } else {
        const undated = mapped.filter((p) => !p.posted_at).length;
        log.push(
          `"${group.name}": found ${mapped.length} post(s)${undated ? `, ${undated} without a date` : ""}.`
        );
      }

      posts.push(...mapped);
      scrapedGroupIds.push(group.id);
    } catch (err) {
      log.push(`"${group.name}" failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }

    slowestGroupMs = Math.max(slowestGroupMs, Date.now() - startedAt);
  }

  return {
    posts,
    log,
    scrapedGroupIds,
    // Apify reads public groups only, so a join wall is not a state it can
    // report. A private source returning nothing here is expected, not a
    // finding, and must not clear a badge the browser path set.
    joinWalledGroupIds: [],
    brokenPlatforms: mappedNothing > 0 && mappedNothing === groups.length ? ["facebook"] : [],
  };
}
