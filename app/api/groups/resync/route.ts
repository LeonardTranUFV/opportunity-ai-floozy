import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canRunSignedInBrowser, redactProviderSecrets } from "@/lib/remote-browser";
import { refreshJoinedGroups, NoStoredSessionError } from "@/lib/facebook-groups";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/errors";

/**
 * Re-read the groups a customer belongs to, on demand.
 *
 * The import runs once, during connect, and only sees what Facebook had
 * rendered at that moment — the sidebar populates lazily, so a first pass
 * routinely catches a fraction of someone's groups. It also cannot know about
 * anything joined since. Without a way to ask again, the only fix a customer
 * had was disconnecting and logging in a second time, which is the most
 * expensive action in the product.
 *
 * This reuses the session already stored rather than asking for another login.
 * That is the whole promise of storing it: connect once, and every later read
 * happens without them.
 *
 * The reading itself lives in lib/facebook-groups.ts, shared with the weekly
 * cron that does the same job unattended. Two copies would drift, and the
 * failure when they drift is silent: a refresh that reads a signed-out page
 * reports "no groups", which is indistinguishable from "you belong to none".
 */

export const dynamic = "force-dynamic";
// The platform's own default. Reading a long joined-groups list means
// scrolling a real page, and 60s was below the floor Vercel already gives.
export const maxDuration = 300;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // The `browser` bucket, not `standard`: this boots a real browser at the
  // provider, which costs wall-clock time and proxy bandwidth, and hammering
  // Facebook's groups page from one account is exactly the pattern that gets a
  // session flagged. Deliberately not charged in credits — re-reading your own
  // groups is the product working, not an AI action to meter.
  const rl = await rateLimit(`groups-resync:${user.id}`, LIMITS.browser.limit, LIMITS.browser.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "refreshes");

  if (!canRunSignedInBrowser()) {
    return NextResponse.json({ error: "No cloud browser is configured." }, { status: 501 });
  }

  try {
    const result = await refreshJoinedGroups(supabase, user.id);

    if (result.signedOut) {
      return NextResponse.json({
        found: 0,
        synced: 0,
        message:
          "Couldn't read any groups. Your saved Facebook login may have expired — reconnect the account and try again.",
      });
    }

    return NextResponse.json({
      found: result.found,
      synced: result.synced,
      skipped: result.skipped,
      // New groups arrive inactive, exactly as they do on first connect.
      // Pointing the crawler at forty groups nobody chose is both a consent
      // problem and repeated traffic through that person's own account.
      message: `Found ${result.found} groups, ${result.synced} saved. New ones start switched off — turn on the ones you want watched.`,
    });
  } catch (error) {
    if (error instanceof NoStoredSessionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    // Redacted: Playwright puts the URL it failed to reach into its message,
    // and a provider connect URL carries the API key in its query string.
    const safe = redactProviderSecrets(errorMessage(error));
    console.error(`[groups] resync failed for ${user.id}: ${safe}`);
    return NextResponse.json({ error: `Could not refresh your groups: ${safe}` }, { status: 502 });
  }
}
