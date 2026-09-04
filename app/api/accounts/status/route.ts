import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getChromium } from "@/lib/browser";
import { isHostedDeployment } from "@/lib/deployment";
import { listSessions } from "@/lib/session-store";
import { getAuthSessionPath, formatAuthLaunchError } from "@/lib/auth-session";

interface CheckResult {
  loggedIn: boolean;
  name: string | null;
}

async function checkFacebook(authPath: string): Promise<CheckResult> {
  const chromium = await getChromium();
  const context = await chromium.launchPersistentContext(authPath, { headless: true, channel: "chrome" });
  try {
    const page = await context.newPage();
    // Facebook's feed polls in the background forever, so "networkidle" never
    // resolves and used to time out — falsely reporting logged-out every time.
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    const loggedOutMarker = await page.getByText("Create new account").count();
    const loggedIn = loggedOutMarker === 0;

    let name: string | null = null;
    if (loggedIn) {
      // /me redirects to the logged-in user's own profile — the page <title>
      // ("Name | Facebook") is far more stable to parse than nav DOM, which
      // Facebook restructures often. Best-effort: a failure here shouldn't
      // affect the loggedIn verdict above.
      try {
        await page.goto("https://www.facebook.com/me", { waitUntil: "domcontentloaded", timeout: 15000 });
        // Facebook is a heavy SPA — the tab starts with the generic "Facebook"
        // title and only swaps in the profile name once client JS finishes
        // rendering, well after domcontentloaded. Poll for that instead of a
        // blind fixed sleep; if it never changes, treat as extraction failure.
        await page
          .waitForFunction(() => document.title.trim().toLowerCase() !== "facebook", { timeout: 8000 })
          .catch(() => {});
        const title = await page.title();
        const cleaned = title.replace(/\s*\|\s*Facebook.*$/i, "").trim();
        name = cleaned && cleaned.toLowerCase() !== "facebook" ? cleaned : null;
      } catch {
        // leave name null
      }
    }
    return { loggedIn, name };
  } finally {
    await context.close();
  }
}

async function checkNextdoor(authPath: string): Promise<CheckResult> {
  const chromium = await getChromium();
  const context = await chromium.launchPersistentContext(authPath, { headless: true, channel: "chrome" });
  try {
    const page = await context.newPage();
    await page.goto("https://nextdoor.com/news_feed/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    // Logged-out visitors get redirected to /login or a signup/landing page.
    const loggedIn = !/\/login|\/signup|\/welcome/.test(page.url());

    let name: string | null = null;
    if (loggedIn) {
      try {
        await page
          .waitForFunction(() => document.title.trim().toLowerCase() !== "nextdoor", { timeout: 8000 })
          .catch(() => {});
        const title = await page.title();
        const cleaned = title.replace(/\s*[|–-]\s*Nextdoor.*$/i, "").trim();
        name = cleaned && cleaned.toLowerCase() !== "nextdoor" ? cleaned : null;
      } catch {
        // leave name null
      }
    }
    return { loggedIn, name };
  } finally {
    await context.close();
  }
}

async function checkTwitter(authPath: string): Promise<CheckResult> {
  const chromium = await getChromium();
  const context = await chromium.launchPersistentContext(authPath, { headless: true, channel: "chrome" });
  try {
    const page = await context.newPage();
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    // Logged-out visitors get bounced back to /login (or stay on x.com/ without reaching /home).
    const loggedIn = page.url().includes("/home");

    let name: string | null = null;
    if (loggedIn) {
      try {
        const handleLink = await page.locator('a[href^="/"][aria-label]:has(img)').first();
        name = (await handleLink.getAttribute("aria-label", { timeout: 3000 }).catch(() => null)) || null;
      } catch {
        // leave name null
      }
    }
    return { loggedIn, name };
  } finally {
    await context.close();
  }
}

async function checkLinkedIn(authPath: string): Promise<CheckResult> {
  const chromium = await getChromium();
  const context = await chromium.launchPersistentContext(authPath, { headless: true, channel: "chrome" });
  try {
    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    const loggedIn = page.url().includes("/feed");

    let name: string | null = null;
    if (loggedIn) {
      try {
        await page.goto("https://www.linkedin.com/in/me/", { waitUntil: "domcontentloaded", timeout: 15000 });
        await page
          .waitForFunction(() => document.title.trim().toLowerCase() !== "linkedin", { timeout: 8000 })
          .catch(() => {});
        const title = await page.title();
        const cleaned = title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
        name = cleaned && cleaned.toLowerCase() !== "linkedin" ? cleaned : null;
      } catch {
        // leave name null
      }
    }
    return { loggedIn, name };
  } finally {
    await context.close();
  }
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  /**
   * On the hosted deployment, answer from the stored sessions rather than 501.
   *
   * The checks below drive a real Chrome to see whether a login still works.
   * Vercel has no Chrome, so this route refused outright — and the Session
   * Status panel rendered nothing on the one site where customers actually
   * connect their accounts. Someone who had just linked Facebook was shown an
   * empty box, which reads as "it didn't take".
   *
   * A stored session is real evidence: it exists only because a login
   * succeeded and its cookies were captured. What it cannot say is whether the
   * platform has invalidated it since — so this reports the connection and its
   * date, and does not claim to have verified anything just now. Overstating
   * that would be worse than the blank box, because a customer would trust a
   * green badge over an empty feed.
   *
   * Names are null for the same reason: reading a profile name means loading
   * the profile, which means a browser.
   */
  if (isHostedDeployment()) {
    const sessions = await listSessions(user.id);
    const byPlatform = new Map(sessions.map((s) => [s.platform, s]));
    const connected = (platform: string) => byPlatform.get(platform)?.status === "active";
    const since = (platform: string) => byPlatform.get(platform)?.connectedAt ?? null;

    return NextResponse.json({
      success: true,
      // Lets the panel say how this was determined instead of implying a check.
      source: "stored",
      facebook: connected("facebook"),
      facebookName: null,
      facebookError: null,
      facebookSince: since("facebook"),
      linkedin: connected("linkedin"),
      linkedinName: null,
      linkedinError: null,
      linkedinSince: since("linkedin"),
      nextdoor: connected("nextdoor"),
      nextdoorName: null,
      nextdoorError: null,
      nextdoorSince: since("nextdoor"),
      twitter: connected("twitter"),
      twitterName: null,
      twitterError: null,
      twitterSince: since("twitter"),
    });
  }

  // Each platform now gets its own persistent-context profile directory
  // (see getAuthSessionPath), so these checks no longer contend for one
  // shared Chromium lock and can safely run in parallel.
  const [facebookResult, linkedinResult, nextdoorResult, twitterResult] = await Promise.allSettled([
    checkFacebook(getAuthSessionPath(user.id, "facebook")),
    checkLinkedIn(getAuthSessionPath(user.id, "linkedin")),
    checkNextdoor(getAuthSessionPath(user.id, "nextdoor")),
    checkTwitter(getAuthSessionPath(user.id, "twitter")),
  ]);

  let facebook = false;
  let facebookName: string | null = null;
  let facebookError: string | null = null;
  let linkedin = false;
  let linkedinName: string | null = null;
  let linkedinError: string | null = null;
  let nextdoor = false;
  let nextdoorName: string | null = null;
  let nextdoorError: string | null = null;
  let twitter = false;
  let twitterName: string | null = null;
  let twitterError: string | null = null;

  if (facebookResult.status === "fulfilled") {
    facebook = facebookResult.value.loggedIn;
    facebookName = facebookResult.value.name;
  } else {
    console.error("Facebook status check failed:", facebookResult.reason);
    facebookError = formatAuthLaunchError(String(facebookResult.reason?.message ?? facebookResult.reason), "Facebook");
  }

  if (linkedinResult.status === "fulfilled") {
    linkedin = linkedinResult.value.loggedIn;
    linkedinName = linkedinResult.value.name;
  } else {
    console.error("LinkedIn status check failed:", linkedinResult.reason);
    linkedinError = formatAuthLaunchError(String(linkedinResult.reason?.message ?? linkedinResult.reason), "LinkedIn");
  }

  if (nextdoorResult.status === "fulfilled") {
    nextdoor = nextdoorResult.value.loggedIn;
    nextdoorName = nextdoorResult.value.name;
  } else {
    console.error("Nextdoor status check failed:", nextdoorResult.reason);
    nextdoorError = formatAuthLaunchError(String(nextdoorResult.reason?.message ?? nextdoorResult.reason), "Nextdoor");
  }

  if (twitterResult.status === "fulfilled") {
    twitter = twitterResult.value.loggedIn;
    twitterName = twitterResult.value.name;
  } else {
    console.error("X status check failed:", twitterResult.reason);
    twitterError = formatAuthLaunchError(String(twitterResult.reason?.message ?? twitterResult.reason), "X");
  }

  return NextResponse.json({
    success: true,
    facebook,
    facebookName,
    facebookError,
    linkedin,
    linkedinName,
    linkedinError,
    nextdoor,
    nextdoorName,
    nextdoorError,
    twitter,
    twitterName,
    twitterError,
  });
}
