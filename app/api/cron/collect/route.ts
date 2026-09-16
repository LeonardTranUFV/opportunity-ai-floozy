import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scrapeAndStorePosts } from "@/lib/scrape-and-store";
import { canRunSignedInBrowser } from "@/lib/remote-browser";
import { usersCollectingLocally } from "@/lib/collection-mode";

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
 * So the tick owns the budget. Each run spends at most COLLECT_BUDGET_MS of
 * wall-clock and then stops, whether that covered thirty sources or three,
 * and it does not move when the hundredth customer arrives. That is still the
 * design and it is still the right one.
 *
 * Two things qualify it, both discovered by measuring rather than reasoning,
 * and both written up on the constants below:
 *
 *   - Wall-clock is not the bill. A customer's platforms are crawled
 *     concurrently with a rented browser each, so a tick costs its wall-clock
 *     times the number of platforms — about twice what the original note here
 *     claimed, on this deployment.
 *   - Neither is it independent of concurrency. USER_CONCURRENCY decides how
 *     many customers are in flight at once, and each one holds its own
 *     browsers, so the bill scales with it directly.
 *
 * What still holds: cost does not scale with *customer count*. Twenty
 * customers and two hundred cost the same, because the tick stops when its
 * clock runs out either way. What degrades with scale is coverage — each
 * account is reached less often — and that is the right thing to trade,
 * because it is visible (sources show when they were last checked), gradual,
 * and fixed by choosing to spend more rather than by a surprise invoice.
 *
 * The ceiling is not the expected bill either way. A tick ends as soon as
 * nothing is stale enough to revisit, so a handful of customers costs a few
 * hours a month, not the ceiling — the budget only binds once there are more
 * sources than the schedule can keep fresh.
 *
 * ── Why sources are picked stalest-first, globally ─────────────────────────
 *
 * Every source in every account is ordered by how long it has been since it
 * was read, and the tick works down that list until the budget runs out.
 * Nobody is starved: a source that misses a tick is nearer the front of the
 * next one. A customer with three sources gets them read more often than a
 * customer with fifty, which is exactly right.
 *
 * That ordering was doing less work than it looked like, though, because of
 * how the budget was handed out underneath it. The list decided who went
 * first, and then the first customer was given the entire remaining tick — so
 * "nearer the front next time" meant nothing to anybody who wasn't first.
 * Ordering fairly and then spending it all on one account is not fairness.
 *
 * There is now a per-customer slice as well, sized to the queue rather than
 * fixed, so being on the list means being crawled rather than being ranked.
 * See USER_CONCURRENCY and MIN_SLICE_MS.
 */

export const dynamic = "force-dynamic";

/**
 * 800 seconds, where every other route here is capped at 300.
 *
 * The 300 elsewhere is not a platform limit — Vercel Pro allows 800 with
 * fluid compute — it is a product decision: a person is watching a spinner,
 * and a long idle HTTP/1.1 connection gets dropped before it finishes anyway.
 *
 * Neither is true of a cron. Nobody is waiting, and the only thing the
 * ceiling decides is how many sources one tick can reach before it has to
 * stop. At roughly 45 seconds a source, 260 seconds reaches about five of
 * them; 760 reaches about seventeen. With 28 active sources on this account
 * that is the difference between a full pass taking most of a day and taking
 * a few hours.
 */
export const maxDuration = 800;

/**
 * How much of each tick may be spent driving browsers.
 *
 * Forty seconds short of the ceiling: openPlatformContext has to start and
 * attach to a rented browser before any of this budget is spent, and the
 * database writes and response come after it.
 *
 * Worth writing down what this costs, because it is the one number here that
 * spends money on its own — and worth being careful about it, because the
 * obvious arithmetic is wrong. Twelve ticks a day at 760 seconds looks like
 * 2.5 browser-hours a day, or ~76 a month, comfortably inside the 100 included
 * on Browserbase Developer.
 *
 * That figure counts wall-clock, and wall-clock is only a proxy for the bill
 * while one browser runs at a time. It doesn't: scrapeActiveGroups runs a
 * customer's platforms concurrently and openPlatformContext rents a separate
 * browser for each, so a tick spends 760 seconds times however many platforms
 * that customer has connected. On this deployment the average is two and the
 * maximum three, which puts the real ceiling nearer 150 browser-hours a month.
 *
 * Ticks still end early once nothing is stale, so that remains a ceiling
 * rather than a forecast — today's actual spend is well under it. But the
 * ceiling is what binds once there are more sources than the schedule can keep
 * fresh, and it is the number to check before adding concurrency of any kind.
 * Anything that runs more browsers at once multiplies it directly.
 */
const COLLECT_BUDGET_MS = 760_000;

/**
 * Don't revisit a source read within this window.
 *
 * Was twenty hours, which made the two-hourly cron mostly ceremonial: a source
 * read at midnight was ineligible until eight the following evening, so ten of
 * every twelve ticks woke, found nothing old enough to touch, and went back to
 * sleep. The floor was doing the scheduling, and doing it badly.
 *
 * It was briefly four hours, which fixed that and went too far the other way.
 * Twelve is where it sits now, and the reason is no longer cost.
 *
 * ── What this number really controls ───────────────────────────────────────
 *
 * Not the bill. How often a customer's Facebook session is used, which is what
 * Facebook scores when deciding whether an account is automated. With 25
 * Facebook sources on this account:
 *
 *     20h  ->  ~30 feed loads a day
 *      4h  -> ~150 feed loads a day
 *     12h  ->  ~50 feed loads a day
 *
 * Four hours was set on a Monday and Facebook served
 * "We suspect automated behaviour on your account" the same week, after the
 * heaviest crawling day this deployment had ever done. That is not proof —
 * the worker also ran twice by hand that day and several manual scans on top
 * — but a five-fold increase in session use is not the thing to leave in
 * place while finding out.
 *
 * Twelve keeps the two-hourly cron meaningful (a source comes back up after
 * six ticks rather than ten) at a third of the exposure. Raise it back toward
 * four only with CRAWL_USE_PROXY on and a quiet week behind you.
 *
 * Worth knowing that this number stops mattering as customers arrive. It caps
 * how *often* a source may be revisited; the tick budget caps how *much* is
 * read at all. Past roughly twenty customers the budget binds first and this
 * floor is never the reason anything is skipped.
 */
const MIN_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Customers per tick. A cap on the worst case, not a target.
 *
 * Was eight, when customers were crawled one after another and the number was
 * really a guess at how many could fit end-to-end. With a worker pool the
 * fitting is done by the clock instead, so this goes back to being what it
 * claims to be: a ceiling nobody should reach.
 */
const MAX_USERS_PER_TICK = 24;

/**
 * How many customers are crawled at once.
 *
 * This is the knob that decides the bill, and it is worth saying so plainly
 * because the intuition runs the other way — parallel work "costs nothing
 * extra per unit of work", which is true and beside the point. A tick runs
 * for a fixed wall-clock budget no matter what. Run one customer in it and it
 * buys 760 browser-seconds; run four and it buys four times that. Roughly:
 *
 *     browser-seconds per tick  ~=  USER_CONCURRENCY x COLLECT_BUDGET_MS
 *                                   x platforms-per-customer
 *
 * At four, with this deployment's average of two platforms, a saturated tick
 * costs about 1.7 browser-hours and a saturated month about 600 — well past
 * the 100 the plan includes. Ticks are not saturated today (two customers,
 * both finishing inside one round), so the actual spend is a fraction of
 * that. But this is the number to look at before onboarding, not after.
 *
 * What it buys is the only thing that actually fixes coverage: customers no
 * longer queue behind each other for a wall-clock budget that runs out. Two
 * at a time, a tick still serves every account it has rather than serving one
 * and marking the rest `out_of_time`, which was the bug this replaced.
 *
 * ── Why two rather than four ───────────────────────────────────────────────
 *
 * The provider's limit is not what binds. scrapeActiveGroups already runs a
 * customer's platforms concurrently with a rented browser each, so four
 * customers is up to twelve live browsers against a limit of twenty-five —
 * comfortable.
 *
 * What binds is how it looks from the other side. Every one of those browsers
 * leaves from the same datacentre range unless CRAWL_USE_PROXY is on, so four
 * customers in flight is four accounts browsing Facebook from neighbouring IPs
 * at the same instant. The note on StartSessionOptions.proxyId says it
 * plainly: platforms score IP reputation far more heavily than page
 * behaviour, and correlated accounts are how a whole fleet gets flagged at
 * once rather than one at a time.
 *
 * Two is the compromise while the proxy is off: the starvation fix keeps
 * working, and half as many accounts are visibly in step. Put it back to four
 * once CRAWL_USE_PROXY=1 gives each customer their own egress IP.
 */
const USER_CONCURRENCY = 2;

/**
 * The smallest slice worth opening a browser for.
 *
 * The slice itself is computed per tick rather than fixed, because a fixed
 * one is wrong at both ends. Today there are two customers and one of them
 * has twenty-eight sources: cutting them to a nominal share would spend most
 * of the tick idle and collect less than the old code did. At fifty
 * customers, dividing the budget evenly gives everybody thirty seconds, which
 * is not enough to open a browser and read anything.
 *
 * So the tick divides what it has among the customers actually waiting, and
 * stops dividing here. Past this point it serves fewer customers properly
 * instead of all of them uselessly, and the ones it doesn't reach are at the
 * front of the next tick — the stalest-first ordering already guarantees
 * that, and always did.
 */
const MIN_SLICE_MS = 90_000;

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

  /**
   * Accounts collected on the operator's PC are not this route's to crawl.
   *
   * Skipped here, before a slot is spent, rather than left for
   * scrapeAndStorePosts to decline — otherwise a local account whose sources
   * the worker hasn't reached lately sits at the front of the stalest-first
   * queue every tick, taking a place a cloud customer needed. Reported in the
   * response so a run that crawled nobody still explains itself.
   */
  const localOnly = await usersCollectingLocally(supabase);

  // Distinct users, still in stalest-first order — the first time a user_id
  // appears is at their stalest source.
  const userOrder: string[] = [];
  const seen = new Set<string>();
  for (const row of (staleSources ?? []) as StaleSource[]) {
    if (seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    if (localOnly.has(row.user_id)) continue;
    userOrder.push(row.user_id);
    if (userOrder.length >= MAX_USERS_PER_TICK) break;
  }

  const results: { user_id: string; collected?: number; error?: string }[] = [];
  let outOfTime = 0;

  /**
   * A queue the workers pull from, rather than slices handed out up front.
   *
   * Dealing the list into four fixed piles would be simpler and worse: a pile
   * of customers whose sessions have all expired finishes in seconds while
   * another is still on its first crawl, and the tick ends with three idle
   * workers. Pulling from a shared queue means a worker that finishes early
   * takes the next customer instead of going home.
   */
  const queue = [...userOrder];

  /**
   * What each customer gets, decided once the queue is known.
   *
   * `rounds` is how many passes the pool needs to drain the queue, so the
   * budget divided by it is the slice that lets the last round finish inside
   * the tick. With fewer customers than workers that is one round and
   * everybody gets the whole budget — which is what today's single busy
   * account needs, and what the old code gave it.
   */
  const rounds = Math.max(1, Math.ceil(queue.length / USER_CONCURRENCY));
  const sliceMs = Math.max(MIN_SLICE_MS, Math.floor((COLLECT_BUDGET_MS - 15_000) / rounds));

  const crawlOne = async (userId: string) => {
    const remainingMs = deadline - Date.now();
    // Below this there is not enough left to open a browser and read a single
    // source, so starting one only risks being killed with it still running.
    if (remainingMs < 45_000) {
      outOfTime++;
      return;
    }

    try {
      /**
       * A bounded slice, and never more than the tick has left.
       *
       * The second half of that matters as much as the first. A worker that
       * picks up its last customer with 60 seconds on the clock must not hand
       * them the full slice — scrapeActiveGroups would pace itself against a
       * deadline that outlives the function, and the crawl would be killed
       * mid-write instead of stopping cleanly.
       *
       * scrapeAndStorePosts filters by this user_id explicitly rather than
       * trusting RLS, which matters here and only here — the admin client
       * bypasses RLS, and without that filter this would crawl every
       * customer's sources under one person's session. It matters more now
       * that four of these run at once against one shared client.
       */
      const result = await scrapeAndStorePosts(supabase, userId, {
        budgetMs: Math.min(sliceMs, remainingMs - 15_000),
        minAgeMs: MIN_AGE_MS,
      });
      results.push({ user_id: userId, collected: result.inserted });
    } catch (err) {
      // One customer's expired session must not end the tick for everyone
      // behind them — and with workers sharing a queue, an unhandled throw
      // here would take that worker out entirely, not just this customer.
      results.push({
        user_id: userId,
        error: err instanceof Error ? err.message : "collection failed",
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(USER_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const userId = queue.shift();
        if (userId === undefined) return;
        await crawlOne(userId);
      }
    })
  );

  return NextResponse.json({
    success: true,
    users: results.length,
    out_of_time: outOfTime,
    // Accounts crawled by the worker on the operator's PC instead.
    collected_locally: localOnly.size,
    results,
  });
}
