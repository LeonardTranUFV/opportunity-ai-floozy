import { getChromium } from "@/lib/browser";
import { getAuthSessionPath, hasAuthSession, formatAuthLaunchError } from "@/lib/auth-session";
import { loadSession, saveSession, isSessionPlatform } from "@/lib/session-store";
import { isHostedDeployment } from "@/lib/deployment";
import { getRemoteBrowserProvider } from "@/lib/remote-browser";
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

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
   */
  release: () => Promise<void>;
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
      const browser = await chromium.launch({ headless: true, channel: "chrome" });
      const context = await browser.newContext({
        // Cast because the blob crosses the encryption boundary as `unknown`.
        // It is whatever `context.storageState()` produced when the session
        // was captured, so the shape is Playwright's own.
        storageState: storageState as StorageStateObject,
        viewport: VIEWPORT,
        userAgent: USER_AGENT,
      });

      return {
        context,
        source: "stored",
        release: async () => {
          // Capture before closing — a closed context cannot be asked for its
          // cookies. Failure to write back must not mask whatever the caller
          // was actually doing, so it is swallowed: the session simply keeps
          // its previous state and expires on its own schedule.
          try {
            const refreshed = await context.storageState();
            await saveSession(userId, platform, refreshed);
          } catch {
            /* keep the older stored state */
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
    { headless: true, channel: "chrome", viewport: VIEWPORT, userAgent: USER_AGENT }
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
    context = await chromium.launchPersistentContext(getAuthSessionPath(userId, platform), {
      headless: true,
      channel: "chrome",
      viewport: VIEWPORT,
      userAgent: USER_AGENT,
    });
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
