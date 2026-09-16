import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How many posts each source has collected.
 *
 * This exists because the obvious version is wrong in a way that says nothing
 * about being wrong. Three pages counted posts per source like this:
 *
 *   await supabase.from("posts").select("group_id").in("group_id", groupIds)
 *
 * PostgREST caps an unbounded select at 1000 rows and returns no indication
 * that it did. Past a thousand posts every source after the cut reports zero,
 * and the pages render that as fact: "0 posts collected", in the same
 * typeface as a real number.
 *
 * Measured on the live database when this was found: the table held 5,174
 * posts and the query returned 1,000. Facebook showed 703 against 4,312.
 * Nextdoor showed **zero** against 565 — and Nextdoor is the platform with
 * the best conversion in the account, so its single source displayed "0 posts
 * collected" beside a pause button. That is not a cosmetic bug: the Sources
 * page exists so somebody can decide what to switch off, and it was telling
 * them to switch off the thing that works.
 *
 * Paginated rather than aggregated on the server, deliberately. A `group by`
 * would be one query instead of five, but it needs a view or an RPC, and this
 * project's migrations are applied by hand in the Supabase SQL editor — so a
 * new database object means the pages silently break until somebody runs the
 * SQL. Paging works the moment it deploys, and the volume it walks is a few
 * thousand rows of a single uuid column.
 */
const PAGE = 1000;

/** Safety stop. Nothing renders per-source counts for an account this large. */
const MAX_ROWS = 200_000;

export async function countPostsByGroup(
  supabase: SupabaseClient,
  groupIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (groupIds.length === 0) return counts;

  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("posts")
      .select("group_id")
      .in("group_id", groupIds)
      .range(from, from + PAGE - 1);

    // A failed page leaves the counts short rather than empty, which is the
    // better of two bad answers on a page that is only ever informational.
    if (error || !data) break;

    for (const row of data as { group_id: string | null }[]) {
      if (!row.group_id) continue;
      counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
    }

    if (data.length < PAGE) break;
  }

  return counts;
}
