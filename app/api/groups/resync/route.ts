import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getChromium } from "@/lib/browser";
import { getRemoteBrowserProvider, redactProviderSecrets } from "@/lib/remote-browser";
import { loadSession } from "@/lib/session-store";
import { extractJoinedGroups, syncJoinedGroups } from "@/lib/facebook-groups";
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
 * Note it cannot share `openPlatformContext` from lib/browser-context.ts —
 * that launches Chrome locally, which is precisely what a hosted deployment
 * cannot do. So the stored cookies are injected into a cloud browser instead:
 * same session, different machine.
 */

export const dynamic = "force-dynamic";
// The platform's own default. Reading a long joined-groups list means
// scrolling a real page, and 60s was below the floor Vercel already gives.
export const maxDuration = 300;

interface StoredState {
  cookies?: unknown[];
  origins?: unknown[];
}

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

  const provider = getRemoteBrowserProvider();
  if (!provider) {
    return NextResponse.json({ error: "No cloud browser is configured." }, { status: 501 });
  }

  const storageState = (await loadSession(user.id, "facebook")) as StoredState | null;
  if (!storageState) {
    return NextResponse.json(
      { error: "Connect Facebook first — there's no saved login to read your groups with." },
      { status: 409 }
    );
  }

  let sessionId: string | null = null;

  try {
    const session = await provider.startSession({
      userId: user.id,
      platform: "facebook",
      ...(process.env.CONNECT_USE_PROXY === "1" ? { proxyId: "residential" } : {}),
    });
    sessionId = session.id;

    const chromium = await getChromium();
    const browser = await chromium.connectOverCDP(session.connectUrl);

    try {
      const context = browser.contexts()[0];
      if (!context) {
        return NextResponse.json(
          { error: "The browser did not start properly. Try again in a moment." },
          { status: 502 }
        );
      }

      // Inject rather than construct. A CDP-attached browser already has its
      // context; `newContext({ storageState })` would create a second, empty
      // one and read a signed-out Facebook — which looks identical to "you
      // have no groups" and is the failure most worth avoiding here.
      const cookies = Array.isArray(storageState.cookies) ? storageState.cookies : [];
      if (cookies.length) {
        await context.addCookies(cookies as Parameters<typeof context.addCookies>[0]);
      }

      const page = context.pages()[0] ?? (await context.newPage());
      const groups = await extractJoinedGroups(page);

      if (!groups.length) {
        // Distinguishable from a successful empty result on purpose: reaching
        // the page while signed out returns nothing, and telling somebody they
        // are in no groups when their login has simply expired sends them
        // looking in the wrong place.
        return NextResponse.json({
          found: 0,
          synced: 0,
          message:
            "Couldn't read any groups. Your saved Facebook login may have expired — reconnect the account and try again.",
        });
      }

      const result = await syncJoinedGroups(supabase, user.id, groups);

      return NextResponse.json({
        ...result,
        // New groups arrive inactive, exactly as they do on first connect.
        // Pointing the crawler at forty groups nobody chose is both a consent
        // problem and repeated traffic through that person's own account.
        message: `Found ${result.found} groups, ${result.synced} saved. New ones start switched off — turn on the ones you want watched.`,
      });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (error) {
    // Redacted: Playwright puts the URL it failed to reach into its message,
    // and connectUrl carries the provider API key in its query string.
    const safe = redactProviderSecrets(errorMessage(error));
    console.error(`[groups] resync failed for ${user.id}: ${safe}`);
    return NextResponse.json({ error: `Could not refresh your groups: ${safe}` }, { status: 502 });
  } finally {
    // Always release. An idle cloud browser bills until its own timeout, and
    // this route can be called far more often than connect.
    if (sessionId) {
      await provider.endSession(sessionId).catch((err) => {
        console.error(`[groups] failed to release session ${sessionId}:`, err);
      });
    }
  }
}
