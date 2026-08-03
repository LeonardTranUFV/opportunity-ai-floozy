import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { type AgentProfile } from "@/lib/ai";
import { evaluateAgentPosts } from "@/lib/scan-agent";
import { scrapeAndStorePosts } from "@/lib/scrape-and-store";
import { InsufficientCreditsError } from "@/lib/credits";

const ALLOWED_RANGE_DAYS = [1, 3, 7];

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
  try {
    const scrapeResult = await scrapeAndStorePosts(supabase, user.id);
    scraped = scrapeResult.inserted;
    scrapeLog = scrapeResult.log;
  } catch (error) {
    scrapeLog = [`Scrape skipped: ${error instanceof Error ? error.message : "unknown error"}`];
  }

  try {
    const result = await evaluateAgentPosts(supabase, agent as AgentProfile, user.id, rangeDays);
    return NextResponse.json({
      success: true,
      scraped,
      scrape_log: scrapeLog,
      evaluated: result.evaluated,
      opportunities_found: result.opportunitiesFound,
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
