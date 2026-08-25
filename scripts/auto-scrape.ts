// Local-only scheduled scraper: run on a timer (Windows Task Scheduler, e.g.
// every 4 hours) on the operator's own PC to keep `posts` fresh without a
// human clicking "Scrape Active Groups Now". This can NEVER run on Vercel —
// it needs a real, logged-in Chrome profile per user/platform on local disk
// (see lib/auth-session.ts) — so it's a standalone script, not an API route.
//
// Pointed at the PRODUCTION database (see --env below) this is what makes
// Facebook, LinkedIn, Nextdoor and X work for customers on the hosted site at
// all. Vercel serves the app and scores the posts; this machine does the
// crawling that Vercel physically cannot, and writes the results into the same
// Supabase project the hosted app reads. Nothing else bridges that gap.
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
// Usage: npx tsx scripts/auto-scrape.ts [--env <file>]
//   npx tsx scripts/auto-scrape.ts                    # local .env
//   npx tsx scripts/auto-scrape.ts --env .env.worker  # production Supabase

import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { scrapeActiveGroups, sessionPlatform, type GroupToScrape } from "@/lib/scraper";
import { hasAuthSession } from "@/lib/auth-session";
import { hasStoredSession } from "@/lib/session-store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

// Which credentials to run against. The default stays .env so nothing about
// running this locally changes; --env is how the same script is aimed at the
// production project without editing .env and risking a dev session writing
// into customer data by accident.
const envFlag = process.argv.indexOf("--env");
const envFile = envFlag !== -1 ? process.argv[envFlag + 1] : ".env";
if (envFlag !== -1 && !envFile) {
  console.error("--env needs a filename, e.g. --env .env.worker");
  process.exit(1);
}
const envPath = path.resolve(projectRoot, envFile);
const loaded = config({ path: envPath });
// A file named explicitly and then not found is a typo worth stopping on —
// silently falling back would run against whichever project .env happens to
// point at, which for this script means the wrong customers' data. A missing
// default .env just falls through to the clearer "Missing ..." check below.
if (loaded.error && envFlag !== -1) {
  console.error(`[auto-scrape] could not read ${envPath}: ${loaded.error.message}`);
  process.exit(1);
}
console.log(`[auto-scrape] credentials from ${envFile}`);

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
    // Reddit needs no login of its own. Everything else is read through that
    // specific customer's session, which lives in one of two places: a
    // `storageState` blob in `browser_sessions` (usable from any machine, and
    // how self-serve connect stores it), or a Chrome profile directory on THIS
    // PC (how everything connected before that existed). Either will do.
    //
    // Aimed at production this script sees every hosted customer's sources, so
    // many will be connected on neither — and scraping those anyway is
    // actively harmful, not merely useless: Playwright would create the
    // missing profile directory, read the signed-out wall, and the run would
    // mark the source freshly scraped. Skip them, and name them, so it stays
    // obvious who is still waiting on a connection rather than quietly
    // collecting nothing.
    //
    // Sequential rather than fanned out: this is one indexed lookup per group
    // against a database the crawl is about to work hard anyway, and it is
    // nothing next to the browser time that follows.
    const runnable: typeof userGroups = [];
    const notConnected: typeof userGroups = [];
    for (const g of userGroups) {
      const platform = sessionPlatform(g.platform);
      const connected =
        platform === "reddit" ||
        (await hasStoredSession(userId, platform)) ||
        hasAuthSession(userId, platform);
      (connected ? runnable : notConnected).push(g);
    }

    for (const g of notConnected) {
      console.log(
        `  [auto-scrape] "${g.name}" skipped — no ${sessionPlatform(g.platform)} session for user ${userId}, stored or on this machine.`
      );
    }
    if (runnable.length === 0) {
      console.log(`[auto-scrape] user ${userId}: nothing runnable here, skipping.`);
      continue;
    }

    console.log(`[auto-scrape] user ${userId}: scraping ${runnable.length} group(s)...`);
    const groupsToScrape: GroupToScrape[] = runnable.map((g) => ({
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
