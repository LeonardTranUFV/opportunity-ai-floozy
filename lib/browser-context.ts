import { getChromium } from "@/lib/browser";
import { getAuthSessionPath, hasAuthSession, formatAuthLaunchError } from "@/lib/auth-session";
import { loadSession, saveSession, isSessionPlatform } from "@/lib/session-store";
import { isHostedDeployment } from "@/lib/deployment";
import { getRemoteBrowserProvider } from "@/lib/remote-browser";
import { collectsLocally } from "@/lib/collection-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BrowserContext, BrowserContextOptions } from "playwright";

/**
 * The object form of Playwright's storageState — `{ cookies, origins }`.
 * The option also accepts a file path as a string, which is exactly what this
 * module exists to stop relying on, so that arm is excluded here.
 */
type StorageStateObject = Extract<
  NonNullable<BrowserContextOptions["storageState"]>,
  { cookies: unknown }
>;

/**
 * One way to open a signed-in browser context for a customer, whichever place
 * their session happens to live.
 *
 * There are three:
 *
 *   cloud   — the same stored session, loaded into a browser rented from the
 *             provider. Used where no local Chrome exists, which means the
 *             hosted deployment. This is what stops collection depending on
 *             one particular computer being switched on.
 *
 *   stored  — a `storageState` blob in `browser_sessions`, decrypted here and
 *             loaded into a fresh local context. Works on any machine, which is
 *             the whole point: it is what lets a customer connect from the
 *             hosted site and a worker elsewhere do the crawling. Preferred
 *             over cloud wherever Chrome is available, because it is free.
 *
 *   profile — a Playwright persistent-context directory under
 *             `../.auth_sessions`, on the operator's own PC. Everything
 *             connected before this change lives here, and those customers
 *             must keep being crawled while they migrate.
 *
 * Callers should not care which. They ask for a context, use it, and call
 * `release()`; the difference is entirely inside here.
 */

const VIEWPORT = { width: 1280, height: 900 } as const;

/**
 * How a Chrome launched on this machine presents itself to the platforms.
 *
 * Two things gave every local crawl away, and neither had anything to do with
 * pacing. Measured on the operator's PC against about:blank, with Chrome 153
 * installed:
 *
 *   - `navigator.webdriver` was **true**. Playwright launches Chrome with
 *     --enable-automation, which sets the one property every automated
 *     browser has and no real one does. Any page reads it in a line of script.
 *   - The user agent was hardcoded to Chrome/**120** — there to hide the
 *     "HeadlessChrome" that headless Chrome otherwise announces, which is fair,
 *     but frozen at a version from late 2023. Chrome also sends client hints
 *     (sec-ch-ua) carrying its real version, so every request claimed 120 in
 *     one header and 153 in the next. A mismatch between those is among the
 *     first things bot detection compares.
 *
 * So: drop --enable-automation and the AutomationControlled blink feature,
 * which is what makes navigator.webdriver false again; and build the user
 * agent from the version actually installed, in the reduced MAJOR.0.0.0 form
 * real Chrome has sent since 110, so the two headers agree.
 *
 * The rented cloud browser is deliberately untouched — it is attached over CDP
 * with the provider's own consistent fingerprint, and overriding its user
 * agent would reintroduce exactly this mismatch from the other side.
 */
const LOCAL_LAUNCH: { channel: "chrome"; ignoreDefaultArgs: string[]; args: string[] } = {
  channel: "chrome",
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled"],
};

function osToken(): string {
  if (process.platform === "darwin") return "Macintosh; Intel Mac OS X 10_15_7";
  if (process.platform === "linux") return "X11; Linux x86_64";
  return "Windows NT 10.0; Win64; x64";
}

function userAgentFor(chromeVersion: string): string {
  const major = chromeVersion.split(".")[0];
  return `Mozilla/5.0 (${osToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

type Chromium = Awaited<ReturnType<typeof getChromium>>;
let installedChromeVersion: Promise<string> | null = null;

/**
 * The installed Chrome's version, probed once per process.
 *
 * A persistent-context launch takes its user agent before any browser exists
 * to ask, so this starts one throwaway instance up front — about a second, and
 * once, not per crawl. Chrome updates itself, which is exactly why the answer
 * is read rather than written down. A failed probe is not cached, so the next
 * caller tries again instead of inheriting a rejection.
 */
function probeChromeVersion(chromium: Chromium): Promise<string> {
  installedChromeVersion ??= (async () => {
    const browser = await chromium.launch({ headless: true, ...LOCAL_LAUNCH });
    try {
      return browser.version();
    } finally {
      await browser.close();
    }
  })().catch((err) => {
    installedChromeVersion = null;
    throw err;
  });
  return installedChromeVersion;
}

/**
 * Launch options for a persistent Chrome profile on this machine — the crawl's
 * and the login's, which must match: a session captured by one fingerprint and
 * replayed by another is its own kind of inconsistency.
 */
export async function localProfileLaunchOptions(chromium: Chromium, headless = true) {
  return {
    headless,
    ...LOCAL_LAUNCH,
    viewport: VIEWPORT,
    userAgent: userAgentFor(await probeChromeVersion(chromium)),
  };
}

export type SessionSource = "stored" | "profile" | "cloud";

export type PlatformContext = {
  context: BrowserContext;
  source: SessionSource;
  /**
   * Close the browser, and for a stored session write the current cookies back
   * first.
   *
   * That write-back is not housekeeping. Facebook and LinkedIn rotate session
   * cookies as you browse and expire the ones they replaced; a context that
   * loads the same frozen blob every crawl ages out within days. Persisting
   * what the platform just handed us is what makes a connection last. A
   * persistent-context profile does this on disk by itself, which is why the
   * profile path skips it.
   *
   * Pass `{ signedOut: true }` when the crawl found itself logged out, and the
   * write-back is skipped. The same mechanism that keeps a session alive
   * destroys it here: a crawl that lands on the login wall ends holding the
   * cookies of a logged-out browser, and saving those over a customer's stored
   * session is how a recoverable interruption becomes a reconnect.
   *
   * Seen live: Facebook stopped collecting at 07:00, every later tick logged
   * "signed out — reconnect the account in Settings", and each one wrote its
   * empty state back over the last. If the block had been transient — a
   * checkpoint, a rate limit, a redirect — the cookies that would have
   * recovered it were gone after the first attempt.
   */
  release: (opts?: { signedOut?: boolean }) => Promise<void>;
};

/**
 * Open a context for `userId` on `platform`, preferring a stored session.
 *
 * Returns null when there is nothing to open — no stored session and no local
 * profile. Callers are expected to skip that customer and name them in the
 * log: aimed at the production database the crawler sees every customer's
 * sources, and most of them will not be connected on any one worker.
 */
export async function openPlatformContext(
  userId: string,
  platform: string
): Promise<PlatformContext | null> {
  /**
   * A platform an account collects locally is never crawled from here.
   *
   * Checked in this function because every hosted path that touches a
   * platform comes through it — scheduled collection, the scrape and scan
   * buttons, the weekly group refresh, group discovery. The callers that walk
   * customers skip these accounts before they get here and say why; this is
   * the backstop for whichever path gets added next and forgets to.
   *
   * Returning null is the existing "nothing to open" answer, which every
   * caller already handles by skipping the customer. Only on the hosted side:
   * the worker running on the operator's PC is exactly where these accounts
   * are supposed to be crawled.
   */
  if (isHostedDeployment() && (await collectsLocally(createAdminClient(), userId, platform))) {
    return null;
  }

  const chromium = await getChromium();

  if (isSessionPlatform(platform)) {
    const storageState = await loadSession(userId, platform);

    /**
     * No local Chrome? Rent one.
     *
     * This is what stops the product depending on a particular computer being
     * switched on. Everything below launches Chrome on *this* machine, which
     * on Vercel does not exist — so collection only ever ran from the
     * operator's own PC, and every customer's leads stopped when it did. That
     * is not a position anyone can sell from.
     *
     * The cloud browser is the same one connect already uses, so this adds a
     * third source rather than a second system. Local stays preferred where it
     * works: it is free, whereas a rented browser bills by the minute and its
     * proxy by the gigabyte.
     */
    if (storageState && isHostedDeployment()) {
      const provider = getRemoteBrowserProvider();
      if (!provider) return null;

      /**
       * Crawls do NOT inherit the connect proxy, and that is a cost decision
       * with numbers behind it.
       *
       * Measured on the live account: a connect session spends about 13 MB of
       * proxy data, and the plan includes 1 GB a month. Connect happens once
       * per customer, so that is roughly 79 of them — fine. A crawl happens on
       * a schedule, pulls feeds full of images, and would exhaust the same
       * allowance in days.
       *
       * The asymmetry is also about what the proxy is for. It exists because a
       * datacentre IP triggers Meta's bot check at *login*. A crawl arrives
       * already authenticated, carrying a session that platform issued itself,
       * so it is a far weaker signal.
       *
       * CRAWL_USE_PROXY turns it on if collection starts getting blocked —
       * which is the symptom that would justify the bill.
       */
      const session = await provider.startSession({
        userId,
        platform,

        /**
         * Two settings that only make sense for a crawl, both about what
         * happens when this function doesn't get to finish.
         *
         * A crawl lives inside one invocation, and that invocation can be cut
         * off at the platform's time limit. `release()` below is what ends the
         * rented session; if it never runs, a browser with nobody driving it
         * bills until it times out on its own. With keepAlive off the dropped
         * connection ends the session by itself, and this timeout is the
         * backstop for anything that slips past even that.
         *
         * **`idleTimeoutSeconds` is a misnomer.** The provider takes it as
         * `timeout`, and that is the session's TOTAL lifetime, not an idle
         * period — this repo proved it twice already: the free tier "capped
         * sessions at five minutes and rejected a larger timeout outright"
         * (remote-browser-browserbase.ts), and a human actively driving a
         * connect through 2FA still died "at 303, 307, 309 or 310 seconds —
         * the cap, every time" (cloud-connect.tsx).
         *
         * So 120 was not a backstop, it was a ceiling. It was harmless while
         * the crawl budget was 45 seconds and became the binding constraint
         * the moment the collect cron went to a 760-second budget: the budget
         * said seventeen sources a tick, the browser died after two. 900 puts
         * it safely above the route's own 800-second maxDuration, so the
         * invocation is what ends a crawl, which is the thing that was always
         * meant to.
         *
         * Connect keeps the opposite settings for equally good reasons.
         */
        keepAlive: false,
        idleTimeoutSeconds: 900,

        ...(process.env.CRAWL_USE_PROXY === "1" ? { proxyId: "residential" } : {}),
      });

      const browser = await chromium.connectOverCDP(session.connectUrl);
      const context = browser.contexts()[0];
      if (!context) {
        await provider.endSession(session.id).catch(() => {});
        return null;
      }

      // Injected into the context CDP already attached to, never a fresh one.
      // `newContext({ storageState })` would build an empty context and read a
      // signed-out page, which is indistinguishable from "this customer has
      // nothing" and would quietly return zero leads forever.
      const cookies = (storageState as StorageStateObject).cookies ?? [];
      if (cookies.length) {
        await context.addCookies(cookies as Parameters<typeof context.addCookies>[0]);
      }

      return {
        context,
        source: "cloud",
        release: async () => {
          // Same write-back as the stored path: platforms rotate session
          // cookies as you browse, and persisting what they just handed us is
          // what keeps a connection alive for months rather than days.
          try {
            const refreshed = await context.storageState();
            await saveSession(userId, platform, refreshed);
          } catch {
            /* keep the older stored state */
          }
          await browser.close().catch(() => {});
          // Always, on every path — a rented browser nobody released bills
          // until its own timeout.
          await provider.endSession(session.id).catch(() => {});
        },
      };
    }

    if (storageState) {
      const browser = await chromium.launch({ headless: true, ...LOCAL_LAUNCH });
      const context = await browser.newContext({
        // Cast because the blob crosses the encryption boundary as `unknown`.
        // It is whatever `context.storageState()` produced when the session
        // was captured, so the shape is Playwright's own.
        storageState: storageState as StorageStateObject,
        viewport: VIEWPORT,
        // The browser already exists here, so its version is read directly
        // rather than probed. See LOCAL_LAUNCH.
        userAgent: userAgentFor(browser.version()),
      });

      return {
        context,
        source: "stored",
        release: async (opts) => {
          // Capture before closing — a closed context cannot be asked for its
          // cookies. Failure to write back must not mask whatever the caller
          // was actually doing, so it is swallowed: the session simply keeps
          // its previous state and expires on its own schedule.
          //
          // Skipped entirely when the caller saw a login wall. Keeping the
          // stored session is strictly better there: either it is genuinely
          // dead and the customer has to reconnect anyway, or the block was
          // transient and the old cookies are the ones that still work.
          if (!opts?.signedOut) {
            try {
              const refreshed = await context.storageState();
              await saveSession(userId, platform, refreshed);
            } catch {
              /* keep the older stored state */
            }
          }
          await context.close();
          await browser.close();
        },
      };
    }
  }

  // Fall back to a profile directory on this machine. Checked rather than
  // launched blind: Playwright CREATES a persistent-context directory it does
  // not find, so launching for an unconnected customer would sign nobody in,
  // scrape the logged-out wall, and leave an empty profile behind that makes
  // them look connected next time.
  if (!hasAuthSession(userId, platform)) return null;

  const context = await chromium.launchPersistentContext(
    getAuthSessionPath(userId, platform),
    await localProfileLaunchOptions(chromium)
  );

  return {
    context,
    source: "profile",
    release: async () => {
      await context.close();
    },
  };
}

/**
 * Copy a session that currently exists only as a local profile directory into
 * `browser_sessions`, so it stops being tied to this machine.
 *
 * Runs the profile up once headless, takes its storageState and stores it.
 * This is how the operator's already-connected customers move across without
 * anybody logging into Facebook a second time.
 */
export async function migrateProfileToStore(
  userId: string,
  platform: string
): Promise<{ migrated: boolean; reason?: string }> {
  if (!isSessionPlatform(platform)) {
    return { migrated: false, reason: `${platform} needs no browser session` };
  }
  if (!hasAuthSession(userId, platform)) {
    return { migrated: false, reason: "no local profile on this machine" };
  }

  const chromium = await getChromium();
  let context;
  try {
    context = await chromium.launchPersistentContext(
      getAuthSessionPath(userId, platform),
      await localProfileLaunchOptions(chromium)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { migrated: false, reason: formatAuthLaunchError(message, platform) };
  }

  try {
    const storageState = await context.storageState();
    await saveSession(userId, platform, storageState);
    return { migrated: true };
  } catch (err) {
    return {
      migrated: false,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  } finally {
    await context.close();
  }
}
