import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scrapeAndStorePosts } from "@/lib/scrape-and-store";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

/**
 * Five minutes, which is the platform's own default — this route was pinned to
 * 60 seconds, below it.
 *
 * That number was written when the ceiling really was 60. It hasn't been for a
 * while: with fluid compute the default is 300s on every plan and Pro allows
 * 800s. So the app was throttling itself to a fifth of what it was already
 * paying for, and the visible symptom was a customer clicking "check for new
 * posts" over and over because each run only reached two or three sources.
 *
 * Not the full 800s. A person is watching a spinner while this runs, and a
 * ten-minute request is also long enough for an intermediate network layer to
 * drop an idle HTTP/1.1 connection — which would look like a failure after
 * doing all the work. Unattended collection belongs on the cron, where nobody
 * is waiting; this is the on-demand path.
 */
export const maxDuration = 300;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  // The browser bucket, not standard. This opens a rented browser and may run
  // for five minutes; unlimited, one account in a loop can spend the whole
  // month's browser hours — and every other customer's scheduled collection
  // shares that budget.
  const rl = await rateLimit(`scrape:${user.id}`, LIMITS.browser.limit, LIMITS.browser.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "source checks");

  try {
    // Twenty seconds short of the ceiling, so the response and the database
    // writes that follow still have room. See scrapeAndStorePosts.
    const { scraped, inserted, log, brokenPlatforms } = await scrapeAndStorePosts(supabase, user.id, {
      budgetMs: maxDuration * 1000 - 20_000,
    });
    if (scraped === 0) {
      // "No posts found" is the right message only when the feeds really were
      // empty. When the canary says a platform's extractor stopped matching,
      // saying "no posts found" actively hides a bug behind a plausible
      // non-answer — the exact failure this check exists to end.
      const brokenNote =
        brokenPlatforms.length > 0
          ? `Nothing collected — ${brokenPlatforms.join(" and ")} extraction looks broken, not quiet. See the log.`
          : null;
      return NextResponse.json({
        success: true,
        scraped: 0,
        inserted: 0,
        log,
        broken_platforms: brokenPlatforms,
        message:
          brokenNote ??
          (log[0] === "No active groups to scrape."
            ? "No active groups to scrape. Go to Community Discovery and activate at least one group first."
            : "No posts found across your active groups this run."),
      });
    }
    return NextResponse.json({
      success: true,
      scraped,
      inserted,
      log,
      broken_platforms: brokenPlatforms,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scrape failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
