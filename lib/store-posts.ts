import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScrapedPost } from "@/lib/scraper";
import { isExactPostUrl } from "@/lib/post-url";

/**
 * Writes scraped posts for one account, with any Supabase client.
 *
 * The same three-step write as lib/scrape-and-store.ts (which needs the
 * request-scoped client, so cannot be called from a cron or the worker):
 *
 *   1. insert, DO NOTHING on conflict: new posts land whole, rows already
 *      held are untouched
 *   2. set posted_at only where this read found a date
 *   3. set post_url only where this read found the post's own link
 *
 * so a re-read never replaces a real date or permalink with nothing. See the
 * long note in scripts/auto-scrape.ts for how that went wrong once.
 *
 * `areaByGroup` tags posts from Floozy's area groups with their area (column
 * from migration 0021). Left out for client groups, so this still works on a
 * database without 0021.
 */
export async function storeScrapedPosts(
  supabase: SupabaseClient,
  userId: string,
  posts: ScrapedPost[],
  areaByGroup?: Map<string, string | null>
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  if (posts.length === 0) return { inserted: 0, errors };

  const deduped = new Map<string, ScrapedPost>();
  for (const p of posts) deduped.set(p.external_post_id, p);

  const rows = [...deduped.values()].map((p) => {
    const area = areaByGroup?.get(p.group_id);
    return {
      user_id: userId,
      group_id: p.group_id,
      platform: p.platform,
      external_post_id: p.external_post_id,
      post_url: p.post_url,
      author_name: p.author_name,
      author_profile_url: p.author_profile_url,
      posted_at: p.posted_at,
      raw_text: p.raw_text,
      ...(area ? { area_id: area } : {}),
    };
  });

  type Row = (typeof rows)[number];
  const identity = (r: Row) => ({
    user_id: r.user_id,
    group_id: r.group_id,
    platform: r.platform,
    external_post_id: r.external_post_id,
    author_name: r.author_name,
    author_profile_url: r.author_profile_url,
    raw_text: r.raw_text,
  });

  // PostgREST needs every row in one upsert to carry the same columns.
  const tagged = rows.filter((r) => "area_id" in r);
  const plain = rows.filter((r) => !("area_id" in r));

  let inserted = 0;
  for (const batch of [tagged, plain]) {
    if (batch.length === 0) continue;
    const { error, count } = await supabase
      .from("posts")
      .upsert(batch, { onConflict: "user_id,external_post_id", ignoreDuplicates: true, count: "exact" });
    if (error) {
      errors.push(`insert failed: ${error.message}`);
      continue;
    }
    inserted += count ?? 0;
  }
  if (errors.length) return { inserted, errors };

  const dated = rows.filter((r) => r.posted_at).map((r) => ({ ...identity(r), posted_at: r.posted_at }));
  if (dated.length) {
    const { error } = await supabase.from("posts").upsert(dated, { onConflict: "user_id,external_post_id" });
    if (error) errors.push(`date update failed: ${error.message}`);
  }

  const linked = rows.filter((r) => isExactPostUrl(r.post_url)).map((r) => ({ ...identity(r), post_url: r.post_url }));
  if (linked.length) {
    const { error } = await supabase.from("posts").upsert(linked, { onConflict: "user_id,external_post_id" });
    if (error) errors.push(`link update failed: ${error.message}`);
  }

  return { inserted, errors };
}
