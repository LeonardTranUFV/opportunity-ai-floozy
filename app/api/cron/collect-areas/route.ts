import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectPublicAreaGroups } from "@/lib/floozy-collect";

/**
 * Floozy's public area groups, read through Apify (step 3 of the shared-leads
 * plan). No Facebook login is involved, so this is the one Facebook path that
 * is safe to run from the cloud. Private area groups are read by the PC
 * worker instead; clients' own sources by /api/cron/collect.
 *
 * Spending is bounded twice: by the tick (BUDGET_MS of wall-clock) and by the
 * day (APIFY_DAILY_RESULTS results across all areas, counted in
 * collector_runs). Does nothing until APIFY_TOKEN and FLOOZY_COLLECTOR_USER_IDS
 * are set and migration 0022 is applied, and says which is missing.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const BUDGET_MS = 720_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not set" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await collectPublicAreaGroups(createAdminClient(), { budgetMs: BUDGET_MS });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "area collection failed" },
      { status: 500 }
    );
  }
}
