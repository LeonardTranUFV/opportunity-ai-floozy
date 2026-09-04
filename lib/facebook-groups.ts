import type { Page } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openPlatformContext } from "@/lib/browser-context";

/**
 * Reading the list of groups an account has actually joined.
 *
 * Extracted from the local connect route so the cloud connect flow can use the
 * same implementation. Two copies of this would drift, and the failure when it
 * drifts is silent: a customer connects, sees no groups, and concludes the
 * product does not work.
 */

export interface DiscoveredGroup {
  name: string;
  url: string;
}

/**
 * Scrape the joined-groups list from an already-signed-in Facebook page.
 *
 * Deliberately class-agnostic. Facebook's generated class names change without
 * notice, so this reads the shape of the URL instead — anything under
 * `/groups/<identifier>` that is not one of Facebook's own utility tabs. That
 * survives a redesign; a class selector does not.
 */
export async function extractJoinedGroups(page: Page): Promise<DiscoveredGroup[]> {
  // NOT "networkidle". Facebook holds long-poll and websocket connections
  // open for as long as the page is alive, so the network never goes idle and
  // this goto always threw:
  //
  //   page.goto: Timeout 25000ms exceeded ... waiting until "networkidle"
  //
  // Which the caller reported as "Could not refresh your groups" — a failure
  // that looked like a broken session or a Facebook block, and was neither.
  // The same mistake was fixed in the group-search route; this copy was
  // missed because it only runs on a path that used to be operator-only.
  //
  // Wait for the group links themselves. That is the actual signal, it
  // arrives long before the network would have settled, and if it never
  // arrives the extraction below returns an empty list rather than throwing.
  await page.goto("https://www.facebook.com/groups/", {
    waitUntil: "domcontentloaded",
    timeout: 25_000,
  });
  await page
    .waitForSelector('a[href*="/groups/"]', { timeout: 15_000 })
    .catch(() => {});
  // The sidebar keeps populating after the first links paint.
  await page.waitForTimeout(3_000);

  return page.evaluate(() => {
    const results: { name: string; url: string }[] = [];

    document.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const text = a.textContent ? a.textContent.trim() : "";

      if (
        href.includes("/groups/") &&
        !href.match(/groups\/(feed|discover|search|create|joins|categories)/)
      ) {
        try {
          const urlObj = new URL(href, window.location.origin);
          const paths = urlObj.pathname.split("/");
          const groupIndex = paths.indexOf("groups");

          if (groupIndex !== -1 && paths[groupIndex + 1]) {
            const cleanUrl = `https://www.facebook.com/groups/${paths[groupIndex + 1]}`;
            // Two characters is below any real group name and filters out the
            // icon-only links that sit beside each entry.
            if (text && text.length > 2 && !results.some((r) => r.url === cleanUrl)) {
              results.push({ name: text, url: cleanUrl });
            }
          }
        } catch {
          /* one malformed entry shouldn't abandon the rest of the list */
        }
      }
    });

    return results;
  });
}

export interface GroupSyncResult {
  found: number;
  synced: number;
  skipped: number;
}

/**
 * The caller supplies the client, so this works with either the request-scoped
 * one (RLS scopes it to the signed-in user, which is what connect uses) or the
 * service-role one. Typed as SupabaseClient rather than a hand-written minimal
 * shape: the query builder is thenable rather than a real Promise, so a
 * structural type looks right and does not compile.
 */
type GroupUpserter = SupabaseClient;

/**
 * Write discovered groups into `groups`, **inactive**.
 *
 * Inactive on purpose: connecting an account should not silently point the
 * crawler at forty groups the customer never chose to monitor. They pick.
 * Beyond consent that is also cost and platform risk — every active source is
 * repeated traffic through that person's own account.
 */
export async function syncJoinedGroups(
  supabase: GroupUpserter,
  userId: string,
  groups: DiscoveredGroup[]
): Promise<GroupSyncResult> {
  const result: GroupSyncResult = { found: groups.length, synced: 0, skipped: 0 };

  for (const group of groups) {
    const { data, error } = await supabase
      .from("groups")
      .upsert(
        { user_id: userId, platform: "facebook", name: group.name, url: group.url, active: false },
        { onConflict: "user_id,url", ignoreDuplicates: false }
      )
      .select("id");

    if (error) {
      console.error(`[groups] could not save "${group.name}": ${error.message}`);
      result.skipped++;
    } else if (data && data.length > 0) {
      result.synced++;
    } else {
      result.skipped++;
    }
  }

  return result;
}

/**
 * How a completed group refresh is remembered.
 *
 * A `settings` row rather than a column on `browser_sessions`, which is where
 * it structurally belongs. The reason is deployment, not design: this project's
 * migrations are applied by hand in the Supabase SQL editor, so a new column
 * means the scheduled refresh silently fails until somebody runs that SQL —
 * from a phone, in another timezone, in the middle of testing. A row in a table
 * that already exists works the moment it deploys.
 *
 * Nothing sensitive lives in it. The worst a customer could do by writing their
 * own key through the settings API is change when their own groups are
 * re-read, which costs about one browser-minute.
 */
export const GROUPS_REFRESHED_AT_KEY = "facebook_groups_refreshed_at";

/**
 * There is no stored Facebook login for this customer at all.
 *
 * Its own type because the two answers need different words and a different
 * status: "connect Facebook first" is something the customer can act on, and
 * "could not refresh your groups" is not. Collapsing them into one thrown
 * string sent someone whose session had simply never existed to look for a
 * fault in the app.
 */
export class NoStoredSessionError extends Error {
  constructor() {
    super("Connect Facebook first — there's no saved login to read your groups with.");
    this.name = "NoStoredSessionError";
  }
}

/**
 * Re-read one customer's joined Facebook groups and save any new ones.
 *
 * Shared by the button and the weekly cron so the two cannot drift — the
 * failure when they drift is silent and specific: a scheduled refresh that
 * quietly reads a signed-out page returns "no groups", which is
 * indistinguishable from "you have joined none".
 *
 * Goes through openPlatformContext rather than starting a browser here. That
 * seam already knows all three places a session can live, opens rented
 * browsers with the settings a background job needs (no keep-alive, short
 * timeout) and writes refreshed cookies back on release — none of which a
 * hand-rolled copy in a route would do.
 */
export async function refreshJoinedGroups(
  supabase: SupabaseClient,
  userId: string
): Promise<GroupSyncResult & { signedOut: boolean }> {
  const opened = await openPlatformContext(userId, "facebook");
  if (!opened) {
    throw new NoStoredSessionError();
  }

  try {
    const page = opened.context.pages()[0] ?? (await opened.context.newPage());
    const groups = await extractJoinedGroups(page);

    // An empty list is reported as its own outcome rather than as a successful
    // sync of nothing. Reaching the page while signed out returns exactly this,
    // and telling somebody they belong to no groups when their login has merely
    // expired sends them looking in the wrong place entirely.
    if (!groups.length) {
      return { found: 0, synced: 0, skipped: 0, signedOut: true };
    }

    const result = await syncJoinedGroups(supabase, userId, groups);
    return { ...result, signedOut: false };
  } finally {
    await opened.release();
  }
}
