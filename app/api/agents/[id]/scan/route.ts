import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { type AgentProfile } from "@/lib/ai";
import { evaluateAgentPosts } from "@/lib/scan-agent";
import { scrapeAndStorePosts } from "@/lib/scrape-and-store";
import { InsufficientCreditsError } from "@/lib/credits";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

const ALLOWED_RANGE_DAYS = [1, 3, 7];

/**
 * A scan collects posts and then hands a batch to Gemini, so its wall clock is
 * set by two external services rather than by anything in this handler.
 * Vercel's default cap is short enough to cut that off mid-flight, and what the
 * customer sees is a function timeout — indistinguishable, from the dashboard,
 * from a scan that simply found nothing. 60s is the Hobby-plan ceiling; raise
 * it with the plan if scans start reaching it.
 */
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params;
  const supabase = await createClient();

  const body = await request.json().catch(() => ({}));
  const rangeDays = ALLOWED_RANGE_DAYS.includes(body.rangeDays) ? body.rangeDays : 3;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`agent-scan:${user.id}`, LIMITS.browser.limit, LIMITS.browser.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "scans");

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .single();

  if (agentError || !agent) {
    return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
  }

  // Scrape active groups first so Scan always has fresh posts to evaluate —
  // users shouldn't have to remember a separate manual "Scrape" step.
  // A scrape failure (e.g. Facebook session expired) shouldn't block
  // evaluating whatever posts are already sitting in Supabase.
  let scraped = 0;
  let scrapeLog: string[] = [];
  let brokenPlatforms: string[] = [];
  try {
    // Roughly a third of the invocation. A scan is two external services in
    // series — crawl, then Gemini — and the crawl is the one that will happily
    // use every second it is given. Whatever it doesn't reach is picked up by
    // the next run, stalest first; an evaluation cut off halfway is just a
    // timeout the customer reads as "found nothing".
    const scrapeResult = await scrapeAndStorePosts(supabase, user.id, { budgetMs: 20_000 });
    scraped = scrapeResult.inserted;
    scrapeLog = scrapeResult.log;
    brokenPlatforms = scrapeResult.brokenPlatforms;
  } catch (error) {
    scrapeLog = [`Scrape skipped: ${error instanceof Error ? error.message : "unknown error"}`];
  }

  try {
    const result = await evaluateAgentPosts(supabase, agent as AgentProfile, user.id, rangeDays);
    return NextResponse.json({
      success: true,
      scraped,
      scrape_log: scrapeLog,
      broken_platforms: brokenPlatforms,
      evaluated: result.evaluated,
      opportunities_found: result.opportunitiesFound,
      locally_filtered: result.locallyFiltered,
      ai_calls: result.aiCalls,
      message: result.message,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Scan failed",
        scraped,
        scrape_log: scrapeLog,
      },
      { status: error instanceof InsufficientCreditsError ? 402 : 502 }
    );
  }
}
