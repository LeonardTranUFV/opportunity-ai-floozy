import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchAreaPosts } from "@/lib/lead-matcher";

/**
 * Hands Floozy's area posts to matching clients (step 4 of the shared-leads
 * plan). Hourly, so leads still arrive when the PC worker is off; the worker
 * runs the same matcher after each collection and the two never classify the
 * same post twice (lib/lead-matcher.ts claims posts first). On Vercel the AI
 * is the Claude API, then Gemini (lib/ai-provider.ts).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const BUDGET_MS = 700_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not set" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await matchAreaPosts(createAdminClient(), { budgetMs: BUDGET_MS });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "matching failed" },
      { status: 500 }
    );
  }
}
