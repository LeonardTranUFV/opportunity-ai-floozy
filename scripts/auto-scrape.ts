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
import { isExactPostUrl } from "@/lib/post-url";
import { localCollectionModes, isCollectedLocally, type LocalPlatforms } from "@/lib/collection-mode";
import { refreshJoinedGroups, GROUPS_REFRESHED_AT_KEY } from "@/lib/facebook-groups";
import { evaluateAgentPosts } from "@/lib/scan-agent";
import type { AgentProfile } from "@/lib/ai";
import { readyProviders } from "@/lib/ai-provider";
import { collectorIds, collectSettings, pickDueGroups, logCollectorRun } from "@/lib/floozy-collect";
import { storeScrapedPosts } from "@/lib/store-posts";
import { matchAreaPosts } from "@/lib/lead-matcher";

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

async function collect(localModes: Map<string, LocalPlatforms>, crawlEveryone: boolean, collectors: Set<string>) {
  const { data: allGroups, error: groupsError } = await supabase
    .from("groups")
    .select("id, user_id, platform, name, url, last_scraped_at")
    .eq("active", true);

  if (groupsError) {
    console.error("[auto-scrape] failed to load groups:", groupsError.message);
    process.exit(1);
  }

  // Only the platforms each account collects here. An account can keep some
  // on the cloud — the operator's Nextdoor, which this PC cannot reach from
  // Vietnam — and those are the cloud's to read, not this machine's to retry.
  //
  // Floozy's collector accounts are left out: their area groups have their own
  // slower pass (collectFloozyPrivate), and their public ones are Apify's.
  const groups = (crawlEveryone
    ? allGroups ?? []
    : (allGroups ?? []).filter((g) => isCollectedLocally(localModes.get(g.user_id), g.platform))
  ).filter((g) => !collectors.has(g.user_id));

  if (!groups || groups.length === 0) {
    console.log("[auto-scrape] no active groups for the accounts in scope, nothing to collect.");
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

      const checkedAt = new Date().toISOString();

      if (result.scrapedGroupIds.length > 0) {
        // Reading the feed proves membership is not the problem, so clear any
        // stale flag — joining a group should make the warning go away by
        // itself on the next run.
        await supabase
          .from("groups")
          .update({
            last_scraped_at: checkedAt,
            needs_membership: false,
            membership_checked_at: checkedAt,
          })
          .in("id", result.scrapedGroupIds);
      }

      if (result.joinWalledGroupIds.length > 0) {
        // No last_scraped_at here: nothing was read, and that column is the
        // heartbeat the UI shows as "working".
        await supabase
          .from("groups")
          .update({ needs_membership: true, membership_checked_at: checkedAt })
          .in("id", result.joinWalledGroupIds);
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

        /**
         * Establish rows first, then improve them. Never downgrade.
         *
         * This was a single upsert carrying every column, which resolves a
         * conflict with DO UPDATE — so re-reading a post we already had
         * overwrote `posted_at` with null and overwrote a real permalink with
         * the group's feed URL whenever that pass could not see them. That is
         * the same bug that was found and fixed in lib/scrape-and-store.ts;
         * this file duplicates the persistence step (see the header comment)
         * and the fix was never carried across, so the worker kept eroding
         * what the hosted path had stopped eroding.
         *
         * It survived unnoticed because it only destroys data it happens to
         * have: Facebook is 82% undated, so null-over-null is a no-op most of
         * the time. Nextdoor is 98% dated, and every one of those is a real
         * date this write would have thrown away on any run that read the
         * feed without them.
         *
         * So the write is split by intent, exactly as it is there:
         *
         *   1. DO NOTHING on conflict, carrying every column. New posts land
         *      whole, fallback URL and all. Rows we already hold are untouched.
         *   2. One narrow update per improvable column, sent only for the rows
         *      that actually carry something better this time.
         */
        const identity = (r: (typeof rows)[number]) => ({
          user_id: r.user_id,
          group_id: r.group_id,
          platform: r.platform,
          external_post_id: r.external_post_id,
          author_name: r.author_name,
          author_profile_url: r.author_profile_url,
          raw_text: r.raw_text,
        });

        const { error: insertError, count } = await supabase
          .from("posts")
          .upsert(rows, {
            onConflict: "user_id,external_post_id",
            ignoreDuplicates: true,
            count: "exact",
          });

        if (insertError) {
          console.error(`  [auto-scrape] insert failed for user ${userId}:`, insertError.message);
        } else {
          const dated = rows.filter((r) => r.posted_at).map((r) => ({ ...identity(r), posted_at: r.posted_at }));
          if (dated.length) {
            const { error } = await supabase
              .from("posts")
              .upsert(dated, { onConflict: "user_id,external_post_id" });
            if (error) console.error(`  [auto-scrape] date update failed for user ${userId}:`, error.message);
          }

          const linked = rows
            .filter((r) => isExactPostUrl(r.post_url))
            .map((r) => ({ ...identity(r), post_url: r.post_url }));
          if (linked.length) {
            const { error } = await supabase
              .from("posts")
              .upsert(linked, { onConflict: "user_id,external_post_id" });
            if (error) console.error(`  [auto-scrape] link update failed for user ${userId}:`, error.message);
          }

          totalScraped += result.posts.length;
          // With DO NOTHING this is genuinely new rows. It used to count
          // inserts and updates together, which read as ten times more
          // collection than had actually happened — 361 reported against 26
          // real on the run that turned this up.
          totalInserted += count ?? 0;
        }
      }
    } catch (err) {
      console.error(`  [auto-scrape] user ${userId} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[auto-scrape] collected: scraped ${totalScraped} post(s), ${totalInserted} new.`);
}

/**
 * Floozy's private area groups (step 3 of the shared-leads plan).
 *
 * Read with each collector's own Facebook profile from this PC, never the
 * cloud, and slowly: at most FLOOZY_PC_GROUPS_PER_RUN groups per profile per
 * run, and none re-read within FLOOZY_PC_GROUP_MIN_AGE_HOURS (defaults 6 and
 * 8). These profiles now carry the ban risk the clients used to, so they get
 * the gentlest schedule in the system. Public area groups are skipped here:
 * Apify reads those without any login (/api/cron/collect-areas).
 *
 * Posts are stored under the collector with the group's area, ready for the
 * matcher (step 4) to hand to clients.
 */
async function collectFloozyPrivate(collectors: string[]) {
  if (collectors.length === 0) return;
  const settings = collectSettings();

  const { data, error } = await supabase
    .from("groups")
    .select("id, user_id, platform, name, url, area_id, last_scraped_at")
    .eq("owner_kind", "floozy")
    .eq("active", true)
    .eq("platform", "facebook")
    .or("access.is.null,access.eq.private")
    .in("user_id", collectors);
  if (error) {
    console.error(`[floozy] can't read area groups (are migrations 0021 and 0022 applied?): ${error.message}`);
    return;
  }

  for (const collectorId of collectors) {
    const own = (data ?? []).filter((g) => g.user_id === collectorId);
    if (own.length === 0) continue;

    const connected = (await hasStoredSession(collectorId, "facebook")) || hasAuthSession(collectorId, "facebook");
    if (!connected) {
      console.log(
        `[floozy] collector ${collectorId.slice(0, 8)}: ${own.length} private group(s) waiting, but no Facebook login on this PC. Run: npx tsx scripts/local-login.ts --env .env.worker --platform facebook --user ${collectorId}`
      );
      continue;
    }

    const due = pickDueGroups(own, Date.now(), settings.pcMinAgeMs, settings.pcGroupsPerRun);
    if (due.length === 0) {
      console.log(`[floozy] collector ${collectorId.slice(0, 8)}: all ${own.length} private group(s) read recently.`);
      continue;
    }

    console.log(`[floozy] collector ${collectorId.slice(0, 8)}: reading ${due.length} of ${own.length} private group(s)...`);
    const startedAt = new Date().toISOString();
    try {
      const result = await scrapeActiveGroups(
        due.map((g) => ({ id: g.id, platform: g.platform, name: g.name, url: g.url })),
        collectorId
      );
      for (const line of result.log) console.log(`  ${line}`);
      const checkedAt = new Date().toISOString();

      if (result.scrapedGroupIds.length > 0) {
        await supabase
          .from("groups")
          .update({ last_scraped_at: checkedAt, needs_membership: false, membership_checked_at: checkedAt })
          .in("id", result.scrapedGroupIds);
      }
      if (result.joinWalledGroupIds.length > 0) {
        await supabase
          .from("groups")
          .update({ needs_membership: true, membership_checked_at: checkedAt })
          .in("id", result.joinWalledGroupIds);
        console.log(`  ${result.joinWalledGroupIds.length} group(s) need this profile to join first.`);
      }

      let newTotal = 0;
      for (const g of due) {
        const posts = result.posts.filter((p) => p.group_id === g.id);
        const stored = await storeScrapedPosts(supabase, collectorId, posts, new Map([[g.id, g.area_id]]));
        for (const e of stored.errors) console.error(`  [floozy] "${g.name}": ${e}`);
        newTotal += stored.inserted;
        await logCollectorRun(supabase, {
          source: "pc",
          group_id: g.id,
          collector_id: collectorId,
          area_id: g.area_id,
          started_at: startedAt,
          items: posts.length,
          posts_new: stored.inserted,
          error: result.joinWalledGroupIds.includes(g.id)
            ? "join wall"
            : result.scrapedGroupIds.includes(g.id)
              ? stored.errors.join("; ") || null
              : "not read",
        });
      }
      console.log(`[floozy] collector ${collectorId.slice(0, 8)}: ${result.posts.length} post(s) read, ${newTotal} new.`);
    } catch (err) {
      console.error(`[floozy] collector ${collectorId.slice(0, 8)} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * The weekly re-read of which Facebook groups an account has joined.
 *
 * The hosted cron does this for cloud customers and skips local accounts
 * (app/api/cron/refresh-groups), because reading the joined-groups page is a
 * Facebook request like any other. So it happens here instead, on the same
 * weekly clock and recorded under the same settings key, or a local account
 * would silently stop picking up groups it joins.
 */
const GROUP_REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

async function refreshGroupsIfDue(userId: string) {
  const { data: mark } = await supabase
    .from("settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", GROUPS_REFRESHED_AT_KEY)
    .maybeSingle();
  const last = mark?.value ? Date.parse(mark.value as string) : 0;
  if (!Number.isNaN(last) && Date.now() - last < GROUP_REFRESH_EVERY_MS) return;

  console.log(`[auto-scrape] user ${userId}: weekly group refresh...`);
  try {
    const result = await refreshJoinedGroups(supabase, userId);
    if (result.signedOut) {
      // Not recorded as done — nothing was read, and marking it would push the
      // next attempt a week out on the strength of a failed read.
      console.log(`  group refresh read nothing — the Facebook session looks signed out.`);
      return;
    }
    await supabase
      .from("settings")
      .upsert({ user_id: userId, key: GROUPS_REFRESHED_AT_KEY, value: new Date().toISOString() }, { onConflict: "user_id,key" });
    console.log(`  found ${result.found} joined group(s), ${result.synced} synced (new ones arrive paused).`);
  } catch (err) {
    console.error(`  group refresh failed:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Scoring, run here instead of waiting on the hosted cron.
 *
 * The hosted scan is fenced in by a serverless invocation — five minutes, and
 * at most a thousand posts a pass — which is why a backlog outlives it. Here
 * neither limit exists: deadline is null, and the loop keeps asking for another
 * pass until one comes back with nothing left to score. evaluated_posts is
 * what makes that safe to repeat; a post scored once is never scored again, by
 * this loop or by the hosted auto-scan that may also be running.
 *
 * Only agents with auto-scan switched on. That dropdown is the operator's
 * existing answer to "which agents should run without me clicking", and each
 * agent spends credits independently — scoring every agent would quietly bill
 * for ones like "Eminant" that have never produced a lead.
 *
 * Seven days and undated posts included: the widest scan the app offers, which
 * is what the operator asked for when choosing to run this locally.
 */
const LOCAL_SCAN_RANGE_DAYS = 7;
const MAX_SCORING_PASSES = 10;

async function scoreAgents(userId: string) {
  if (readyProviders("scoring").length === 0) {
    console.log(
      `[auto-scrape] user ${userId}: scoring skipped — no AI provider is set up here. Sign in to Claude Code or Codex, or add ANTHROPIC_API_KEY or GEMINI_API_KEY to .env.worker (see lib/ai-provider.ts). The hosted auto-scan still scores agents that have it switched on.`
    );
    return;
  }

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, goal, location, keywords, negative_keywords")
    .eq("user_id", userId)
    .not("auto_scan_interval_hours", "is", null);

  if (!agents?.length) {
    console.log(
      `[auto-scrape] user ${userId}: no agents have auto-scan switched on, so nothing is scored here. Turn it on for the agents you want run on the Agents page.`
    );
    return;
  }

  for (const agent of agents as AgentProfile[]) {
    let evaluated = 0;
    let found = 0;
    try {
      for (let pass = 1; pass <= MAX_SCORING_PASSES; pass++) {
        const r = await evaluateAgentPosts(supabase, agent, userId, LOCAL_SCAN_RANGE_DAYS, null, 1000, true);
        evaluated += r.evaluated;
        found += r.opportunitiesFound;
        // A pass that scored nothing means the backlog is empty — or that it
        // stopped short for a reason another pass won't fix (credits, quota).
        // Either way, looping again would only repeat it.
        if (r.evaluated === 0) {
          if (r.message && pass === 1) console.log(`  "${agent.name}": ${r.message}`);
          break;
        }
      }
      console.log(`[auto-scrape] "${agent.name}": scored ${evaluated} post(s), ${found} new lead(s).`);
    } catch (err) {
      console.error(`  "${agent.name}" scoring stopped:`, err instanceof Error ? err.message : err);
    }
  }
}

async function run() {
  console.log(`[auto-scrape] starting at ${new Date().toISOString()}`);

  /**
   * Whose accounts this machine is responsible for.
   *
   * By default, only accounts marked collection_mode=local (lib/collection-mode).
   * This used to crawl every connected customer from whatever PC ran it, which
   * was fine when every crawl came from here. With clients now collected by
   * the cloud and the operator's own account collected locally, running both
   * paths over everyone would read each client twice, from two very different
   * IPs, on two unrelated schedules — the pattern most likely to get noticed.
   *
   * `--all` restores the old behaviour for the day it is wanted deliberately.
   * Scoring and group refresh stay limited to local accounts either way: cloud
   * customers are scored and refreshed by the hosted crons.
   */
  const crawlEveryone = process.argv.includes("--all");
  const localModes = await localCollectionModes(supabase);
  const collectorList = await collectorIds(supabase);
  const collectors = new Set(collectorList);
  // Collectors are handled by collectFloozyPrivate, even if one is also
  // marked collection_mode=local (which it should be, to keep the cloud off it).
  const localAccounts = [...localModes.keys()].filter((id) => !collectors.has(id));

  if (collectorList.length) {
    console.log(`[auto-scrape] ${collectorList.length} Floozy collector account(s) from FLOOZY_COLLECTOR_USER_IDS.`);
    await collectFloozyPrivate(collectorList);

    // Hand the area posts to clients now, with this PC's subscription AI,
    // rather than waiting for the hourly cron (which uses the API).
    if (readyProviders("scoring").length > 0) {
      const match = await matchAreaPosts(supabase, { budgetMs: 20 * 60_000 });
      if (match.skipped) console.log(`[match] skipped: ${match.skipped}`);
      for (const line of match.log) console.log(`[match] ${line}`);
    } else {
      console.log("[match] skipped: no AI provider here; the hourly cron matches instead.");
    }
  }

  if (!crawlEveryone && localAccounts.length === 0) {
    console.log(
      collectorList.length
        ? "[auto-scrape] no other accounts are marked for local collection. Done."
        : "[auto-scrape] no accounts are marked for local collection (settings.collection_mode = 'local'), so there is nothing for this machine to do. Run with --all to crawl every connected account."
    );
    return;
  }
  console.log(
    crawlEveryone
      ? "[auto-scrape] --all: crawling every connected account."
      : `[auto-scrape] crawling ${localAccounts.length} local-collection account(s): ${localAccounts.map((id) => { const m = localModes.get(id); return `${id.slice(0, 8)} (${m === "all" ? "every platform" : [...(m ?? [])].join(", ")})`; }).join("; ")}.`
  );

  await collect(localModes, crawlEveryone, collectors);

  for (const userId of localAccounts) {
    // Only when Facebook is one of the platforms this PC collects: otherwise
    // the hosted weekly refresh still does it, and doing it here too would read
    // the same joined-groups page from two places.
    if (isCollectedLocally(localModes.get(userId), "facebook")) await refreshGroupsIfDue(userId);
    await scoreAgents(userId);
  }

  console.log("[auto-scrape] done.");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[auto-scrape] fatal error:", err);
    process.exit(1);
  });
