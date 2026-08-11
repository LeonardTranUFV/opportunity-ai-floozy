import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scrapeAndStorePosts } from "@/lib/scrape-and-store";

/** Paced HTTP reads against an external host — same timeout reasoning as scan. */
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { scraped, inserted, log, brokenPlatforms } = await scrapeAndStorePosts(supabase, user.id);
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
