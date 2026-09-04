import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canRunSignedInBrowser, redactProviderSecrets } from "@/lib/remote-browser";
import { refreshJoinedGroups, GROUPS_REFRESHED_AT_KEY } from "@/lib/facebook-groups";
import { errorMessage } from "@/lib/errors";

/**
 * Re-read everyone's joined Facebook groups, weekly.
 *
 * The import runs once at connect and sees only what Facebook had rendered at
 * that moment — the list loads lazily, so a first pass routinely catches a
 * fraction of somebody's groups. Anything joined afterwards is invisible until
 * they think to press a button they have no reason to know about. A customer
 * who joins a local trade group on Tuesday should not have to be told that the
 * product needs telling.
 *
 * ── Why this is cheap, when crawling is not ────────────────────────────────
 *
 * Crawling costs what it costs because it is every source, every day: a
 * customer with thirty sources is thirty page loads daily. This is one page
 * load per *customer*, weekly. At a hundred customers that is roughly seven
 * browser-hours a month against the hundred the plan includes — small enough
 * that the schedule is chosen for freshness rather than for the bill.
 *
 * Weekly rather than daily anyway, because the thing it detects — a person
 * joining a Facebook group — happens a few times a year, not a few times a
 * week.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Time per tick that may be spent driving browsers. */
const REFRESH_BUDGET_MS = 260_000;

/** Don't re-read a customer's groups more often than this. */
const MIN_AGE_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Enough for one browser to start, load the groups page and scroll it. Below
 * this, starting another customer only risks being killed mid-read with a
 * rented browser still running.
 */
const PER_USER_FLOOR_MS = 60_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not set" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!canRunSignedInBrowser()) {
    return NextResponse.json({
      success: true,
      skipped: "no signed-in browser available on this deployment",
      users: 0,
    });
  }

  const supabase = createAdminClient();
  const deadline = Date.now() + REFRESH_BUDGET_MS;

  // Only accounts with a Facebook login worth reading. An expired or revoked
  // session would open a browser, land on the sign-in wall, and report zero
  // groups — a browser-minute spent to learn nothing.
  const { data: sessions, error } = await supabase
    .from("browser_sessions")
    .select("user_id")
    .eq("platform", "facebook")
    .eq("status", "active");

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const userIds = (sessions ?? []).map((s) => s.user_id as string);
  if (userIds.length === 0) {
    return NextResponse.json({ success: true, users: 0, results: [] });
  }

  // When each was last done. A customer with no row has never been refreshed
  // since connecting, which puts them first.
  const { data: marks } = await supabase
    .from("settings")
    .select("user_id, value")
    .eq("key", GROUPS_REFRESHED_AT_KEY)
    .in("user_id", userIds);

  const lastRefreshed = new Map<string, number>();
  for (const row of marks ?? []) {
    const t = Date.parse(row.value as string);
    if (!Number.isNaN(t)) lastRefreshed.set(row.user_id as string, t);
  }

  const cutoff = Date.now() - MIN_AGE_MS;
  const due = userIds
    .filter((id) => (lastRefreshed.get(id) ?? 0) < cutoff)
    // Stalest first, so whoever this tick cannot reach is at the front of the
    // next one. Same ordering rule as scheduled collection, for the same
    // reason: it makes a queue fair without needing a quota.
    .sort((a, b) => (lastRefreshed.get(a) ?? 0) - (lastRefreshed.get(b) ?? 0));

  const results: { user_id: string; found?: number; synced?: number; note?: string }[] = [];
  let outOfTime = 0;

  for (const userId of due) {
    if (deadline - Date.now() < PER_USER_FLOOR_MS) {
      outOfTime++;
      continue;
    }

    try {
      const result = await refreshJoinedGroups(supabase, userId);

      if (result.signedOut) {
        // Not marked as refreshed: nothing was read, and pretending otherwise
        // would push this customer to the back of the queue for a week on the
        // strength of a failed read.
        results.push({ user_id: userId, note: "read nothing — session may have expired" });
        continue;
      }

      await supabase.from("settings").upsert(
        { user_id: userId, key: GROUPS_REFRESHED_AT_KEY, value: new Date().toISOString() },
        { onConflict: "user_id,key" }
      );

      results.push({ user_id: userId, found: result.found, synced: result.synced });
    } catch (err) {
      // Redacted: Playwright puts the URL it failed to reach into its message,
      // and a provider connect URL carries the API key in its query string.
      const safe = redactProviderSecrets(errorMessage(err));
      console.error(`[groups] scheduled refresh failed for ${userId}: ${safe}`);
      results.push({ user_id: userId, note: safe });
    }
  }

  return NextResponse.json({
    success: true,
    due: due.length,
    users: results.length,
    out_of_time: outOfTime,
    results,
  });
}
