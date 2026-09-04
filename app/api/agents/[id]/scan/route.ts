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
 * set by two external services rather than by anything in this handler. Cut it
 * off mid-flight and the customer sees a timeout — indistinguishable, from the
 * dashboard, from a scan that found nothing.
 *
 * This said 60s because that was once the ceiling. It isn't: fluid compute
 * makes 300s the default on every plan. Both halves below now get five times
 * the room, and both still stop on their own before the limit rather than
 * relying on it.
 */
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  /**
   * Both halves of a scan share one invocation, so both are given a share of
   * it measured from the same start.
   *
   * Ten seconds are left unclaimed at the end. A response still has to be
   * written and the agent's timestamp saved after the work finishes, and being
   * killed during *that* would throw away results already paid for.
   */
  const startedAt = Date.now();
  const RESPONSE_HEADROOM_MS = 10_000;
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
    // A third of the invocation for collecting, the rest for evaluating. The
    // crawl will use everything it is given; evaluation is the half that
    // decides whether the customer sees new opportunities today.
    const scrapeResult = await scrapeAndStorePosts(supabase, user.id, {
      budgetMs: Math.round(maxDuration * 1000 * 0.35),
    });
    scraped = scrapeResult.inserted;
    scrapeLog = scrapeResult.log;
    brokenPlatforms = scrapeResult.brokenPlatforms;
  } catch (error) {
    scrapeLog = [`Scrape skipped: ${error instanceof Error ? error.message : "unknown error"}`];
  }

  try {
    // Whatever is left of the invocation after collecting. Evaluation is the
    // half that can always use more time — a few hundred fresh posts is more
    // Gemini calls than 60 seconds holds — so it takes the remainder rather
    // than a fixed slice, and stops cleanly instead of being cut off.
    const evaluationDeadline = startedAt + (maxDuration * 1000 - RESPONSE_HEADROOM_MS);
    const result = await evaluateAgentPosts(
      supabase,
      agent as AgentProfile,
      user.id,
      rangeDays,
      evaluationDeadline
    );
    return NextResponse.json({
      success: true,
      scraped,
      scrape_log: scrapeLog,
      broken_platforms: brokenPlatforms,
      evaluated: result.evaluated,
      remaining: result.remaining ?? 0,
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
