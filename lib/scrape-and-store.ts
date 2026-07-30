import { createClient } from "@/lib/supabase/server";
import { scrapeActiveGroups } from "@/lib/scraper";

export interface ScrapeAndStoreResult {
  scraped: number;
  inserted: number;
  log: string[];
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
  const { data: activeGroups, error: groupsError } = await supabase
    .from("groups")
    .select("id, platform, name, url, last_scraped_at")
    .eq("active", true);

  if (groupsError) {
    throw new Error(groupsError.message);
  }

  if (!activeGroups || activeGroups.length === 0) {
    return { scraped: 0, inserted: 0, log: ["No active groups to scrape."] };
  }

  const cooldownCutoff = Date.now() - SCRAPE_COOLDOWN_MS;
  const dueGroups = activeGroups.filter(
    (g) => !g.last_scraped_at || new Date(g.last_scraped_at).getTime() < cooldownCutoff
  );
  const skippedGroups = activeGroups.filter((g) => !dueGroups.includes(g));

  const log: string[] = skippedGroups.map(
    (g) => `"${g.name}": skipped — scraped within the last 15 minutes, already fresh.`
  );

  if (dueGroups.length === 0) {
    return { scraped: 0, inserted: 0, log };
  }

  const scrapeResult = await scrapeActiveGroups(dueGroups, userId);
  const posts = scrapeResult.posts;
  log.push(...scrapeResult.log);

  if (scrapeResult.scrapedGroupIds.length > 0) {
    await supabase
      .from("groups")
      .update({ last_scraped_at: new Date().toISOString() })
      .in("id", scrapeResult.scrapedGroupIds);
  }

  if (posts.length === 0) {
    return { scraped: 0, inserted: 0, log };
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

  return { scraped: posts.length, inserted: count ?? posts.length, log };
}
