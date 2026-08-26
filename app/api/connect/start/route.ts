import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRemoteBrowserProvider, redactProviderSecrets } from "@/lib/remote-browser";
import { isSessionPlatform, SESSION_PLATFORMS } from "@/lib/session-store";
import { hasSessionKey, SESSION_KEY_HINT } from "@/lib/session-crypto";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import { getChromium } from "@/lib/browser";
import { errorMessage } from "@/lib/errors";

/**
 * Where each platform's sign-in actually lives.
 *
 * Facebook's /login goes to a full-page form rather than the marketing splash;
 * LinkedIn and X likewise. Nextdoor has no /login path worth the redirect, so
 * its front page is the right target.
 */
const LOGIN_URL: Record<string, string> = {
  facebook: "https://www.facebook.com/login",
  linkedin: "https://www.linkedin.com/login",
  nextdoor: "https://nextdoor.com/login/",
  twitter: "https://x.com/i/flow/login",
};

/**
 * First half of self-serve connect: boot a cloud browser and hand the customer
 * a URL they can watch and type into.
 *
 * This is the route that makes the hosted product possible. The old connect
 * flow (app/api/auth-session/route.ts and siblings) opens a Chrome window on
 * the server's own desktop, which works exactly once — on the operator's PC —
 * and is why Connect Accounts has nothing to offer a hosted customer. Here the
 * browser runs at the provider and only its screen travels.
 *
 * The customer types their own password into that browser. We never see it,
 * never store it, and never proxy it; what we keep afterwards is the resulting
 * session, and only via /api/connect/finish.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Before anything else that costs money. Every successful call here boots a
  // real cloud browser that bills until it times out, so an authenticated
  // caller looping this route is a direct line into our invoice — no exploit
  // needed, just a held-down key. LIMITS.browser (5 per 15 min) is the same
  // bucket the other browser-driving routes use, and is far above what a human
  // connecting an account could ever need.
  const rl = await rateLimit(`connect-start:${user.id}`, LIMITS.browser.limit, LIMITS.browser.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "connection attempts");

  const provider = getRemoteBrowserProvider();
  if (!provider) {
    return NextResponse.json(
      {
        error:
          "No cloud browser is configured for this deployment, so accounts can only be connected locally.",
      },
      { status: 501 }
    );
  }

  // Checked before spending money on a browser, not after. Without a key the
  // finish step would refuse to store the session, and the customer would have
  // logged into Facebook for nothing.
  if (!hasSessionKey()) {
    console.error(`[connect] refusing to start: no session encryption key. ${SESSION_KEY_HINT}`);
    return NextResponse.json(
      { error: "Connecting accounts is temporarily unavailable. The team has been notified." },
      { status: 503 }
    );
  }

  let platform: string;
  try {
    const body = (await request.json()) as { platform?: unknown };
    platform = typeof body.platform === "string" ? body.platform : "";
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!isSessionPlatform(platform)) {
    return NextResponse.json(
      { error: `Unsupported platform. Expected one of: ${SESSION_PLATFORMS.join(", ")}.` },
      { status: 400 }
    );
  }

  try {
    const session = await provider.startSession({ userId: user.id, platform });

    // Point the browser at the login page before the customer sees it.
    //
    // A fresh cloud browser opens on about:blank, so without this the panel
    // says "Log into Facebook below" above an empty window and a URL bar —
    // leaving the customer to know, and type, the right address. Doing it here
    // rather than asking them is the difference between a product and a
    // developer tool.
    //
    // Deliberately not fatal. If this fails the session is still perfectly
    // usable — the live view has a working address bar — so a navigation
    // problem should cost polish, not the whole connect.
    try {
      const chromium = await getChromium();
      const browser = await chromium.connectOverCDP(session.connectUrl);
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(LOGIN_URL[platform], {
        waitUntil: "domcontentloaded",
        timeout: 25_000,
      });
      // No browser.close(): over CDP that would tear down the very session the
      // customer is about to use. Dropping the socket when this invocation
      // ends is enough, and keepAlive is what holds the session open.
    } catch (navError) {
      console.warn(
        `[connect] could not pre-navigate the ${platform} browser: ${redactProviderSecrets(errorMessage(navError))}`
      );
    }

    // Only the id and the viewable URL cross to the client. connectUrl carries
    // the provider API key in its query string and stays on the server: it is
    // the difference between "watch this browser" and "drive any browser on
    // our account".
    return NextResponse.json({
      sessionId: session.id,
      liveViewUrl: session.liveViewUrl,
      platform,
    });
  } catch (error) {
    // Redacted for the same reason as the finish route: an error thrown while
    // talking to the provider can carry a URL with our API key in it. The
    // provider's own JSON body survives redaction, which is what makes a
    // misconfiguration diagnosable from the UI.
    const safe = redactProviderSecrets(errorMessage(error));
    console.error(`[connect] could not start a ${platform} session: ${safe}`);
    return NextResponse.json(
      { error: `Could not start a browser: ${safe}` },
      { status: 502 }
    );
  }
}
