import { getChromium } from "@/lib/browser";
import { getAuthSessionPath, hasAuthSession, formatAuthLaunchError } from "@/lib/auth-session";
import { loadSession, saveSession, isSessionPlatform } from "@/lib/session-store";
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
 * There are two, and there will be two for as long as the migration takes:
 *
 *   stored  — a `storageState` blob in `browser_sessions`, decrypted here and
 *             loaded into a fresh context. Works on any machine, which is the
 *             whole point: it is what lets a customer connect from the hosted
 *             site and a worker elsewhere do the crawling.
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

export type SessionSource = "stored" | "profile";

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
