import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scrapeAndStorePosts } from "@/lib/scrape-and-store";
import { canRunSignedInBrowser } from "@/lib/remote-browser";

/**
 * Unattended collection — the thing that makes this a product rather than a
 * tool somebody has to sit in front of.
 *
 * Until now nothing refreshed a customer's sources on its own. Collection
 * happened when somebody opened the app and clicked, which meant leads were as
 * fresh as the last time that person remembered to look. The sister route
 * (auto-scan) has always run on a schedule, but it only re-reads posts already
 * in the database — so it was hourly AI passes over an increasingly stale
 * corpus.
 *
 * ── Why this is budgeted by the tick, not by the customer ──────────────────
 *
 * A rented browser bills by the minute, so scheduled crawling is the one part
 * of this system that can spend money without anybody asking it to. Budgeting
 * per customer would make the monthly bill a function of how many customers
 * sign up — the number nobody wants to be afraid of.
 *
 * So the tick owns the budget. Each run spends at most COLLECT_BUDGET_MS and
 * then stops, whether that covered thirty sources or three. Hourly, that is a
 * hard ceiling of about 52 browser-hours a month against the 100 the plan
 * includes, and it does not move when the hundredth customer arrives.
 *
 * The ceiling is not the expected bill. A tick ends as soon as nothing is
 * stale enough to revisit, so a handful of customers costs a few hours a
 * month, not fifty — the budget only binds once there are more sources than
 * the schedule can keep fresh.
 *
 * What degrades with scale is *coverage*, not cost: more sources sharing the
 * same minutes means each is visited less often. That is the right thing to
 * trade, because it is visible (sources show when they were last checked),
 * gradual, and fixed by choosing to spend more rather than by a surprise
 * invoice.
 *
 * ── Why sources are picked stalest-first, globally ─────────────────────────
 *
 * Every source in every account is ordered by how long it has been since it
 * was read, and the tick works down that list until the budget runs out.
 * Nobody is starved: a source that misses a tick is nearer the front of the
 * next one. No per-customer quota is needed to make that fair, and none is
 * imposed — a customer with three sources gets them read more often than a
 * customer with fifty, which is exactly right.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * How much of each tick may be spent driving browsers.
 *
 * Forty seconds short of the ceiling: openPlatformContext has to start and
 * attach to a rented browser before any of this budget is spent, and the
 * database writes and response come after it.
 */
const COLLECT_BUDGET_MS = 260_000;

/**
 * Don't revisit a source read within this window.
 *
 * One day, deliberately. Hourly ticks with the interactive 15-minute cooldown
 * would re-read the same sources around the clock, which is 24x the bill for
 * very little more signal — the posts this finds are people asking for a
 * tradesperson, and those sit in a group for days. A daily visit is what the
 * cost model in the route comment above is built on; shortening it multiplies
 * the bill by the same factor.
 */
const MIN_AGE_MS = 20 * 60 * 60 * 1000;

/** Customers per tick. A cap on the worst case, not a target. */
const MAX_USERS_PER_TICK = 8;

interface StaleSource {
  user_id: string;
  last_scraped_at: string | null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not set" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // Nothing to do rather than a slow failure: with no provider configured
  // there is no browser to rent, and every crawl below would fail one source
  // at a time until the tick ran out.
  if (!canRunSignedInBrowser()) {
    return NextResponse.json({
      success: true,
      skipped: "no signed-in browser available on this deployment",
      users: 0,
    });
  }

  const supabase = createAdminClient();
  const deadline = Date.now() + COLLECT_BUDGET_MS;
  const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();

  /**
   * Whose sources are stalest.
   *
   * `null` sorts first with nullsFirst — a source never read is the most
   * overdue thing there is, and a new customer's first collection should not
   * queue behind everybody else's routine refresh.
   *
   * The 500-row window is not a limit on what gets collected; it is a limit on
   * what is read to *decide*. Far more customers than a tick could serve fit
   * inside it, and the ones beyond it are by definition less stale than these.
   */
  const { data: staleSources, error } = await supabase
    .from("groups")
    .select("user_id, last_scraped_at")
    .eq("active", true)
    .or(`last_scraped_at.is.null,last_scraped_at.lt.${cutoff}`)
    .order("last_scraped_at", { ascending: true, nullsFirst: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Distinct users, still in stalest-first order — the first time a user_id
  // appears is at their stalest source.
  const userOrder: string[] = [];
  const seen = new Set<string>();
  for (const row of (staleSources ?? []) as StaleSource[]) {
    if (seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    userOrder.push(row.user_id);
    if (userOrder.length >= MAX_USERS_PER_TICK) break;
  }

  const results: { user_id: string; collected?: number; error?: string }[] = [];
  let outOfTime = 0;

  for (const userId of userOrder) {
    const remainingMs = deadline - Date.now();
    // Below this there is not enough left to open a browser and read a single
    // source, so starting one only risks being killed with it still running.
    if (remainingMs < 45_000) {
      outOfTime++;
      continue;
    }

    try {
      /**
       * The whole remaining tick, not an equal share.
       *
       * A share would leave time unused whenever a customer has fewer sources
       * than their slice covers, and this loop is already fair by ordering:
       * whoever the budget doesn't reach is nearer the front next tick.
       *
       * scrapeAndStorePosts filters by this user_id explicitly rather than
       * trusting RLS, which matters here and only here — the admin client
       * bypasses RLS, and without that filter this would crawl every
       * customer's sources under one person's session.
       */
      const result = await scrapeAndStorePosts(supabase, userId, {
        budgetMs: remainingMs - 15_000,
        minAgeMs: MIN_AGE_MS,
      });
      results.push({ user_id: userId, collected: result.inserted });
    } catch (err) {
      // One customer's expired session must not end the tick for everyone
      // behind them.
      results.push({
        user_id: userId,
        error: err instanceof Error ? err.message : "collection failed",
      });
    }
  }

  return NextResponse.json({
    success: true,
    users: results.length,
    out_of_time: outOfTime,
    results,
  });
}
