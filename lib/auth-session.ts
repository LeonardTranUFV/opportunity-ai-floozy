import path from "path";

/**
 * Every Opportunity AI user gets their own Playwright persistent-context
 * folder per platform, keyed by their Supabase user id, so scraping/outreach
 * always runs through that specific person's connected session — never a
 * session shared across every user of the app. Previously every caller
 * resolved the same hardcoded "../.auth_session" path regardless of who was
 * logged into the dashboard, so one Facebook account carried the load (and
 * the ToS/ban risk) for every customer.
 *
 * Split per-platform (not just per-user) because Chromium only lets one
 * process hold a given profile directory open at a time — with Facebook,
 * LinkedIn, Nextdoor, and X all sharing one folder, a single left-open
 * "Connect" popup or an in-flight status check for any one platform blocked
 * every other platform's login/scrape with "Opening in existing browser
 * session", which read to users as "I have to reconnect every time".
 */
export function getAuthSessionPath(userId: string, platform: string): string {
  return path.resolve(process.cwd(), "../.auth_sessions", userId, platform);
}

/**
 * Playwright's "profile already in use" error means a Chromium process for
 * this exact platform's session folder is still alive — almost always a
 * previous "Connect" popup window the user logged into but never closed, or
 * a status check still in flight. It is not a code bug to keep chasing; the
 * fix is closing the leftover window, not retrying automatically.
 */
export function formatAuthLaunchError(raw: string, platformLabel: string): string {
  const lockMarkers = [
    "Opening in existing browser session",
    "already in use",
    // Playwright's outer error when it detects the profile is locked and its
    // own cleanup/kill attempt then races with the process exiting on its
    // own — the specific lock text above still shows up buried in the
    // embedded browser log, but the *headline* message is this generic one.
    "Target page, context or browser has been closed",
  ];
  if (lockMarkers.some((marker) => raw.includes(marker))) {
    return `A previous ${platformLabel} login window is still open somewhere (check your taskbar, other monitors, or Task Manager for a leftover chrome.exe) — close it, then try again. Only one ${platformLabel} session window can be open at a time.`;
  }
  return raw;
}
