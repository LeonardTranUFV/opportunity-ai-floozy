import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scrapeAndStorePosts } from "@/lib/scrape-and-store";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { scraped, inserted, log } = await scrapeAndStorePosts(supabase, user.id);
    if (scraped === 0) {
      return NextResponse.json({
        success: true,
        scraped: 0,
        inserted: 0,
        log,
        message: log[0] === "No active groups to scrape."
          ? "No active groups to scrape. Go to Community Discovery and activate at least one group first."
          : "No posts found across your active groups this run.",
      });
    }
    return NextResponse.json({ success: true, scraped, inserted, log });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scrape failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
