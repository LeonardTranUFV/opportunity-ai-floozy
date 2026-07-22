import path from "path";

/**
 * Every Opportunity AI user gets their own Playwright persistent-context
 * folder, keyed by their Supabase user id, so scraping/outreach always runs
 * through that specific person's connected Facebook/LinkedIn session —
 * never a session shared across every user of the app. Previously every
 * caller resolved the same hardcoded "../.auth_session" path regardless of
 * who was logged into the dashboard, so one Facebook account carried the
 * load (and the ToS/ban risk) for every customer.
 */
export function getAuthSessionPath(userId: string): string {
  return path.resolve(process.cwd(), "../.auth_sessions", userId);
}
