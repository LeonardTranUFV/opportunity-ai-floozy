// Local-only scheduled scraper: run on a timer (Windows Task Scheduler, e.g.
// every 4 hours) on the operator's own PC to keep `posts` fresh without a
// human clicking "Scrape Active Groups Now". This can NEVER run on Vercel —
// it needs a real, logged-in Chrome profile per user/platform on local disk
// (see lib/auth-session.ts) — so it's a standalone script, not an API route.
//
// Reuses lib/scraper.ts's scrapeActiveGroups (the exact same extraction code
// the manual Scrape button and the agent Scan flow use) so there is only one
// place that knows how to crawl each platform. Only the persistence step
// (cooldown check + upsert into `posts`) is duplicated here from
// lib/scrape-and-store.ts, because that file imports the Next.js
// request-scoped Supabase client (cookies()-based), which doesn't exist
// outside a running Next.js request — this script uses the service-role
// admin client instead and filters by user_id explicitly itself, same
// pattern as app/api/cron/auto-scan/route.ts.
//
// Usage: npx tsx scripts/auto-scrape.ts

import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { scrapeActiveGroups, type GroupToScrape } from "@/lib/scraper";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env") });

const SCRAPE_COOLDOWN_MS = 15 * 60 * 1000;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  const startedAt = new Date().toISOString();
  console.log(`[auto-scrape] starting at ${startedAt}`);

  const { data: groups, error: groupsError } = await supabase
    .from("groups")
    .select("id, user_id, platform, name, url, last_scraped_at")
    .eq("active", true);

  if (groupsError) {
    console.error("[auto-scrape] failed to load groups:", groupsError.message);
    process.exit(1);
  }

  if (!groups || groups.length === 0) {
    console.log("[auto-scrape] no active groups for any user, nothing to do.");
    return;
  }

  const cooldownCutoff = Date.now() - SCRAPE_COOLDOWN_MS;
  const dueGroups = groups.filter(
    (g) => !g.last_scraped_at || new Date(g.last_scraped_at).getTime() < cooldownCutoff
  );
  if (dueGroups.length === 0) {
    console.log("[auto-scrape] every active group was scraped within the last 15 minutes, skipping run.");
    return;
  }

  const groupsByUser = new Map<string, typeof dueGroups>();
  for (const g of dueGroups) {
    const list = groupsByUser.get(g.user_id) ?? [];
    list.push(g);
    groupsByUser.set(g.user_id, list);
  }

  let totalScraped = 0;
  let totalInserted = 0;

  for (const [userId, userGroups] of groupsByUser) {
    console.log(`[auto-scrape] user ${userId}: scraping ${userGroups.length} group(s)...`);
    const groupsToScrape: GroupToScrape[] = userGroups.map((g) => ({
      id: g.id,
      platform: g.platform,
      name: g.name,
      url: g.url,
    }));

    try {
      const result = await scrapeActiveGroups(groupsToScrape, userId);
      for (const line of result.log) console.log(`  ${line}`);

      if (result.scrapedGroupIds.length > 0) {
        await supabase
          .from("groups")
          .update({ last_scraped_at: new Date().toISOString() })
          .in("id", result.scrapedGroupIds);
      }

      if (result.posts.length > 0) {
        const deduped = new Map<string, (typeof result.posts)[number]>();
        for (const p of result.posts) deduped.set(p.external_post_id, p);

        const rows = [...deduped.values()].map((p) => ({
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
          console.error(`  [auto-scrape] insert failed for user ${userId}:`, insertError.message);
        } else {
          totalScraped += result.posts.length;
          totalInserted += count ?? result.posts.length;
        }
      }
    } catch (err) {
      console.error(`  [auto-scrape] user ${userId} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[auto-scrape] done. scraped ${totalScraped} post(s), upserted ${totalInserted}.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[auto-scrape] fatal error:", err);
    process.exit(1);
  });
