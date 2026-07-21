import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scrapeActiveGroups } from "@/lib/scraper";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const { data: activeGroups, error: groupsError } = await supabase
    .from("groups")
    .select("id, platform, name, url")
    .eq("active", true);

  if (groupsError) {
    return NextResponse.json({ success: false, error: groupsError.message }, { status: 500 });
  }

  if (!activeGroups || activeGroups.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: "No active groups to scrape. Go to Community Discovery and activate at least one group first.",
      },
      { status: 400 }
    );
  }

  const { posts, log } = await scrapeActiveGroups(activeGroups);

  if (posts.length === 0) {
    return NextResponse.json({
      success: true,
      scraped: 0,
      inserted: 0,
      log,
      message: "No posts found across your active groups this run.",
    });
  }

  const rows = posts.map((p) => ({
    user_id: user.id,
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
    return NextResponse.json({ success: false, error: insertError.message, log }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    scraped: posts.length,
    inserted: count ?? posts.length,
    log,
  });
}
