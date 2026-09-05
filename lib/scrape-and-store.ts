import { createClient } from "@/lib/supabase/server";
import { scrapeActiveGroups } from "@/lib/scraper";
import { sessionPlatform } from "@/lib/session-platform";
import { canRunSignedInBrowser } from "@/lib/remote-browser";

export interface ScrapeAndStoreResult {
  scraped: number;
  inserted: number;
  log: string[];
  /**
   * Platforms whose extractors look broken this run (see `diagnosePlatform` in
   * lib/scraper.ts). Distinct from an empty result: this means the code needs
   * fixing, and the customer should be told rather than left thinking their
   * sources are just quiet.
   */
  brokenPlatforms: string[];
}

// Skip re-scraping a group this soon after it was last visited. The biggest
// cost in a scan isn't the AI, it's Playwright's human-paced crawl (tens of
// seconds per group) — without this, scanning 4 agents back-to-back in one
// sitting re-scraped the same groups 4 times in a row for no new data.
const SCRAPE_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Scrapes every active group for this user (skipping ones visited within the
 * cooldown window) and upserts fresh posts into Supabase. Shared by the
 * manual "Scrape Active Groups Now" button and the agent Scan flow (which
 * scrapes first so Scan always has fresh posts to evaluate instead of
 * relying on a separate manual step).
 */
export async function scrapeAndStorePosts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  /**
   * How long the browser crawl may take, when the browser is rented.
   *
   * The caller sets this because only the caller knows what else has to happen
   * inside the same serverless invocation. /api/scrape does nothing but this,
   * so it can spend the lot; a scan has to hand a batch to Gemini afterwards
   * and would time out mid-evaluation — which looks exactly like a scan that
   * found nothing — if the crawl ate all 60 seconds first.
   */
  options: {
    budgetMs?: number;
    /**
     * How old a source's last visit must be before it is worth revisiting.
     *
     * Defaults to the 15-minute cooldown, which is right for someone sitting
     * in the app: it stops four back-to-back scans re-reading the same
     * sources. Scheduled collection passes a far longer window — running
     * hourly with a 15-minute cooldown would re-crawl every source 24 times a
     * day, and a rented browser is billed by the minute.
     */
    minAgeMs?: number;
  } = {}
): Promise<ScrapeAndStoreResult> {
  const { data: allGroups, error: groupsError } = await supabase
    .from("groups")
    .select("id, platform, name, url, last_scraped_at")
    // Explicit, not left to RLS. Every caller so far passes a request-scoped
    // client where RLS already restricts this to the signed-in user, so this
    // changes nothing today. It matters for the caller that doesn't: a
    // service-role client bypasses RLS entirely, and this query would then
    // return every customer's sources to be crawled under one person's login.
    .eq("user_id", userId)
    .eq("active", true);

  if (groupsError) {
    throw new Error(groupsError.message);
  }

  if (!allGroups || allGroups.length === 0) {
    return { scraped: 0, inserted: 0, log: ["No active groups to scrape."], brokenPlatforms: [] };
  }

  // Facebook, LinkedIn, Nextdoor and X are read by driving a signed-in
  // browser. Reddit is not: it's an unauthenticated fetch of a public .json
  // endpoint, no browser and no per-user session, so it runs anywhere.
  //
  // The gate is no longer "are we hosted". Hosted used to mean no browser at
  // all — no Chrome on Vercel, no persistent profile — so this dropped every
  // browser platform, and a hosted customer could only ever collect Reddit.
  // openPlatformContext can now rent a browser from the provider, and those
  // groups collect here exactly as they do on the operator's machine.
  //
  // What is still true is that with no provider key there is nothing to rent.
  // Driving a browser that doesn't exist would fail every group one at a time
  // instead of saying so once, which is the only case this filter now covers.
  const browserlessHost = !canRunSignedInBrowser();
  const activeGroups = browserlessHost
    ? allGroups.filter((g) => sessionPlatform(g.platform) === "reddit")
    : allGroups;
  const browserOnly = browserlessHost ? allGroups.length - activeGroups.length : 0;

  const preamble: string[] = [];
  if (browserOnly > 0) {
    preamble.push(
      `${browserOnly} source(s) need a signed-in browser, which isn't set up on this deployment — Reddit sources were scraped as normal.`
    );
  }

  if (activeGroups.length === 0) {
    return {
      scraped: 0,
      inserted: 0,
      log: preamble.length > 0 ? preamble : ["No active groups to scrape."],
      brokenPlatforms: [],
    };
  }

  const cooldownCutoff = Date.now() - (options.minAgeMs ?? SCRAPE_COOLDOWN_MS);
  // Stalest first. A rented browser can only get through part of a long source
  // list before the run's time budget stops it (see scrapeBrowserPlatform), so
  // the order decides which sources are read and which wait. Sorted this way,
  // consecutive runs rotate through everything instead of re-reading the same
  // first few and starving the tail forever. Never scraped sorts first.
  const dueGroups = activeGroups
    .filter((g) => !g.last_scraped_at || new Date(g.last_scraped_at).getTime() < cooldownCutoff)
    .sort(
      (a, b) =>
        (a.last_scraped_at ? new Date(a.last_scraped_at).getTime() : 0) -
        (b.last_scraped_at ? new Date(b.last_scraped_at).getTime() : 0)
    );
  const skippedGroups = activeGroups.filter((g) => !dueGroups.includes(g));

  const log: string[] = [
    ...preamble,
    ...skippedGroups.map((g) => `"${g.name}": skipped — scraped within the last 15 minutes, already fresh.`),
  ];

  if (dueGroups.length === 0) {
    return { scraped: 0, inserted: 0, log, brokenPlatforms: [] };
  }

  const scrapeResult = await scrapeActiveGroups(dueGroups, userId, options.budgetMs);
  const posts = scrapeResult.posts;
  const brokenPlatforms = scrapeResult.brokenPlatforms;
  log.push(...scrapeResult.log);

  const checkedAt = new Date().toISOString();

  if (scrapeResult.scrapedGroupIds.length > 0) {
    // Reading the feed proves membership is not the problem, so clear any
    // stale flag: someone who joins a group should see the warning disappear
    // on the next crawl rather than wonder why it sticks.
    await supabase
      .from("groups")
      .update({
        last_scraped_at: checkedAt,
        needs_membership: false,
        membership_checked_at: checkedAt,
      })
      .in("id", scrapeResult.scrapedGroupIds);
  }

  if (scrapeResult.joinWalledGroupIds.length > 0) {
    // Note this does NOT set last_scraped_at — nothing was read, and that
    // column is the heartbeat the UI shows as "working".
    await supabase
      .from("groups")
      .update({ needs_membership: true, membership_checked_at: checkedAt })
      .in("id", scrapeResult.joinWalledGroupIds);
  }

  if (posts.length === 0) {
    return { scraped: 0, inserted: 0, log, brokenPlatforms };
  }

  // Dedupe across groups within this run — the scraper only dedupes per-group,
  // but the same external_post_id can surface in two different groups in one
  // pass (e.g. a repeated sponsored post), and Postgres's ON CONFLICT DO UPDATE
  // rejects the whole batch if a conflict key appears twice in one statement.
  const dedupedPosts = new Map<string, (typeof posts)[number]>();
  for (const p of posts) dedupedPosts.set(p.external_post_id, p);

  const rows = [...dedupedPosts.values()].map((p) => ({
    user_id: userId,
    group_id: p.group_id,
    platform: p.platform,
    external_post_id: p.external_post_id,
    post_url: p.post_url,
    author_name: p.author_name,
    author_profile_url: p.author_profile_url,
    posted_at: p.posted_at,
    raw_text: p.raw_text,
  }));

  const { error: insertError, count } = await supabase
    .from("posts")
    .upsert(rows, { onConflict: "user_id,external_post_id", count: "exact" });

  if (insertError) {
    throw new Error(insertError.message);
  }

  return { scraped: posts.length, inserted: count ?? posts.length, log, brokenPlatforms };
}
