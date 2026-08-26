import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getChromium } from "@/lib/browser";
import { getRemoteBrowserProvider, redactProviderSecrets } from "@/lib/remote-browser";
import { isSessionPlatform, saveSession } from "@/lib/session-store";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import {
  extractJoinedGroups,
  syncJoinedGroups,
  type GroupSyncResult,
} from "@/lib/facebook-groups";
import { errorMessage } from "@/lib/errors";

/**
 * Second half of self-serve connect: the customer says they are logged in, so
 * attach to their cloud browser, take the session out of it, and store it.
 *
 * "Take the session out of it" is `context.storageState()` — cookies plus
 * localStorage, the same portable blob lib/session-store.ts encrypts and
 * lib/browser-context.ts rehydrates for a crawl. Once it is stored, the
 * browser is disposable, which is the entire point: the login stops living in
 * one place.
 */

/** Signed-in landing pages differ per platform; a login wall does not. */
const LOGGED_IN_COOKIE: Record<string, string> = {
  facebook: "c_user",
  linkedin: "li_at",
  nextdoor: "nd_session",
  twitter: "auth_token",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Cheaper than start — no browser is booted here — but every call still
  // costs a provider lookup, and the ownership check below is the thing
  // standing between a guessed session id and someone else's cookies. Limiting
  // it keeps that check from being something you can retry in a loop.
  const rl = await rateLimit(`connect-finish:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "attempts");

  const provider = getRemoteBrowserProvider();
  if (!provider) {
    return NextResponse.json({ error: "No cloud browser is configured." }, { status: 501 });
  }

  let sessionId: string;
  try {
    const body = (await request.json()) as { sessionId?: unknown };
    sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  const info = await provider.getSession(sessionId);
  if (!info) {
    return NextResponse.json(
      { error: "That browser session has expired. Start the connection again." },
      { status: 410 }
    );
  }

  // The security check this route exists around. A session id travels through
  // the customer's own browser between start and finish, so it must be treated
  // as a claim rather than proof: whoever finishes a session receives the
  // cookies inside it. Passing someone else's id would otherwise hand the
  // caller that person's Facebook login.
  //
  // 404 rather than 403 on mismatch: a caller probing ids should not be able
  // to tell "exists but not yours" from "does not exist".
  if (info.ownerUserId !== user.id) {
    console.warn(
      `[connect] user ${user.id} tried to finish session ${sessionId} owned by ${info.ownerUserId ?? "nobody"}`
    );
    return NextResponse.json({ error: "Unknown browser session." }, { status: 404 });
  }

  const platform = info.platform ?? "";
  if (!isSessionPlatform(platform)) {
    return NextResponse.json({ error: "That session is not for a supported platform." }, { status: 400 });
  }

  try {
    const chromium = await getChromium();
    const browser = await chromium.connectOverCDP(info.connectUrl);

    try {
      // Attaching over CDP adopts the browser the customer has been driving,
      // so its existing context is where the login actually is. A fresh
      // context here would be empty and would store a signed-out session that
      // looks connected until the first crawl silently returns nothing.
      const context = browser.contexts()[0];
      if (!context) {
        return NextResponse.json(
          { error: "That browser session has no page open. Start the connection again." },
          { status: 409 }
        );
      }

      const storageState = await context.storageState();

      // Verify a login actually happened before claiming success. Someone who
      // clicks "I'm done" on the login screen would otherwise get a cheerful
      // "connected", and discover weeks later that nothing was ever collected.
      const marker = LOGGED_IN_COOKIE[platform];
      const signedIn = storageState.cookies.some(
        (cookie) => cookie.name === marker && cookie.value.length > 0
      );
      if (!signedIn) {
        return NextResponse.json(
          {
            error:
              "That browser isn't signed in yet. Finish logging in on the screen above, then try again.",
          },
          { status: 409 }
        );
      }

      await saveSession(user.id, platform, storageState);

      // Import the groups this account is actually in, while the signed-in
      // browser is still open — it is the only moment we have one.
      //
      // Without this a customer finishes connecting and lands on an empty
      // Communities page, having to paste group URLs by hand, which is most of
      // the value of connecting gone. The local connect flow has always done
      // this; the cloud flow was missing it.
      //
      // They arrive INACTIVE. Connecting an account should not quietly point
      // the crawler at forty groups nobody chose — beyond consent, every active
      // source is repeated traffic through that person's own account.
      let sync: GroupSyncResult | null = null;
      if (platform === "facebook") {
        try {
          const page = context.pages()[0] ?? (await context.newPage());
          sync = await syncJoinedGroups(
            supabase,
            user.id,
            await extractJoinedGroups(page)
          );
        } catch (syncError) {
          // Never fatal. The session is saved and the connection is real; a
          // failed import costs convenience, and telling someone their login
          // failed when it did not would be worse.
          console.warn(
            `[connect] group import failed after a successful ${platform} connect: ${redactProviderSecrets(errorMessage(syncError))}`
          );
        }
      }

      return NextResponse.json({
        success: true,
        platform,
        cookieCount: storageState.cookies.length,
        sync,
      });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (error) {
    // Redacted on BOTH paths. Playwright puts the URL it failed to reach into
    // its message, and connectUrl carries the provider API key in its query
    // string — so the obvious version of this handler prints our key into
    // Vercel's logs and hands a copy to the customer's browser. Whoever read it
    // could run browsers on our account until the bill stopped them.
    const safe = redactProviderSecrets(errorMessage(error));
    console.error(`[connect] could not capture the ${platform} session: ${safe}`);
    return NextResponse.json(
      { error: `Could not save that login: ${safe}` },
      { status: 502 }
    );
  } finally {
    // Always release, on every path. An idle cloud browser nobody closed bills
    // until its timeout, and at one session per customer connect that adds up
    // quietly. The stored blob is what matters now; the browser is disposable.
    await provider.endSession(sessionId).catch((err) => {
      console.error(`[connect] failed to release session ${sessionId}:`, err);
    });
  }
}
