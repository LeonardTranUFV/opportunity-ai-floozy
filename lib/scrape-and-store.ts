import { createClient } from "@/lib/supabase/server";
import { scrapeActiveGroups, sessionPlatform } from "@/lib/scraper";
import { isHostedDeployment } from "@/lib/deployment";

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
  userId: string
): Promise<ScrapeAndStoreResult> {
  const { data: allGroups, error: groupsError } = await supabase
    .from("groups")
    .select("id, platform, name, url, last_scraped_at")
    .eq("active", true);

  if (groupsError) {
    throw new Error(groupsError.message);
  }

  if (!allGroups || allGroups.length === 0) {
    return { scraped: 0, inserted: 0, log: ["No active groups to scrape."], brokenPlatforms: [] };
  }

  // Facebook, LinkedIn, Nextdoor and X are read by driving a real Chrome
  // profile off local disk, which Vercel has no way to provide. Reddit is not:
  // it's an unauthenticated fetch of a public .json endpoint, no browser and no
  // per-user session, so it runs anywhere.
  //
  // This used to bail out for every platform at once, which meant a signed-up
  // customer on the hosted site could never collect a single post — the app
  // worked only for whoever ran it on their own machine. Splitting the gate by
  // platform is what lets a hosted account produce real leads on day one.
  const hosted = isHostedDeployment();
  const activeGroups = hosted
    ? allGroups.filter((g) => sessionPlatform(g.platform) === "reddit")
    : allGroups;
  const browserOnly = hosted ? allGroups.length - activeGroups.length : 0;

  const preamble: string[] = [];
  if (browserOnly > 0) {
    preamble.push(
      `${browserOnly} source(s) need a signed-in browser, which this hosted site can't run — Reddit sources were scraped as normal.`
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

  const cooldownCutoff = Date.now() - SCRAPE_COOLDOWN_MS;
  const dueGroups = activeGroups.filter(
    (g) => !g.last_scraped_at || new Date(g.last_scraped_at).getTime() < cooldownCutoff
  );
  const skippedGroups = activeGroups.filter((g) => !dueGroups.includes(g));

  const log: string[] = [
    ...preamble,
    ...skippedGroups.map((g) => `"${g.name}": skipped — scraped within the last 15 minutes, already fresh.`),
  ];

  if (dueGroups.length === 0) {
    return { scraped: 0, inserted: 0, log, brokenPlatforms: [] };
  }

  const scrapeResult = await scrapeActiveGroups(dueGroups, userId);
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
