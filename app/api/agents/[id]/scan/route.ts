import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { evaluatePostsForAgent, type AgentProfile, type RawPostInput } from "@/lib/ai";
import { scrapeAndStorePosts } from "@/lib/scrape-and-store";

// Posts per Gemini request. Larger batches mean fewer total requests (less
// time spent on inter-batch pacing below) — these are short social posts, so
// even 100 of them per call is nowhere near Gemini's 1M-token context window.
const BATCH_SIZE = 100;
const MAX_POSTS_PER_SCAN = 500;
const ALLOWED_RANGE_DAYS = [1, 3, 7];
// Gemini's free tier caps requests per minute (~10 RPM as of mid-2026) and
// does NOT get retried on 429 (see lib/ai.ts) — so a scan with many batches
// has to pace itself under that ceiling rather than firing them back-to-back.
const BATCH_PACING_MS = 6500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PostRow {
  id: string;
  platform: string;
  author_name: string;
  author_profile_url: string | null;
  post_url: string | null;
  raw_text: string;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params;
  const supabase = await createClient();

  const body = await request.json().catch(() => ({}));
  const rangeDays = ALLOWED_RANGE_DAYS.includes(body.rangeDays) ? body.rangeDays : 3;
  const cutoffIso = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

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

  const { data: evaluatedRows } = await supabase
    .from("evaluated_posts")
    .select("source_post_id")
    .eq("agent_id", agentId);
  const evaluatedIds = new Set((evaluatedRows ?? []).map((r) => r.source_post_id));

  // Posts with a parsed timestamp are filtered by that; posts where we couldn't
  // parse a relative age from the page (posted_at is null) fall back to when we
  // scraped them, so they aren't silently excluded from every range.
  const { data: allPosts } = await supabase
    .from("posts")
    .select("id, platform, author_name, author_profile_url, post_url, raw_text")
    .or(`posted_at.gte.${cutoffIso},and(posted_at.is.null,scraped_at.gte.${cutoffIso})`)
    .order("scraped_at", { ascending: false })
    .limit(MAX_POSTS_PER_SCAN);

  const unevaluated = ((allPosts ?? []) as PostRow[]).filter((p) => !evaluatedIds.has(p.id));

  if (unevaluated.length === 0) {
    return NextResponse.json({
      success: true,
      scraped,
      scrape_log: scrapeLog,
      evaluated: 0,
      opportunities_found: 0,
      message: `No new posts in the last ${rangeDays} day${rangeDays === 1 ? "" : "s"} to evaluate.`,
    });
  }

  let totalEvaluated = 0;
  let totalOpportunities = 0;

  // Walk every unevaluated post in AI-request-sized batches — a single scan
  // click used to silently stop after the first 25 posts regardless of how
  // many more were waiting, which made "scan everything" impossible without
  // repeated manual clicks.
  for (let i = 0; i < unevaluated.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(BATCH_PACING_MS);
    const batch = unevaluated.slice(i, i + BATCH_SIZE);
    const postsForAI: RawPostInput[] = batch.map((p) => ({
      post_id: p.id,
      platform: p.platform,
      author_name: p.author_name,
      raw_text: p.raw_text,
      post_url: p.post_url,
      author_profile_url: p.author_profile_url,
    }));

    let evaluations;
    try {
      evaluations = await evaluatePostsForAgent(agent as AgentProfile, postsForAI);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI evaluation failed";
      return NextResponse.json(
        {
          success: false,
          error: `${message} (evaluated ${totalEvaluated} of ${unevaluated.length} posts before this failure — already-found opportunities were saved)`,
          scraped,
          scrape_log: scrapeLog,
          evaluated: totalEvaluated,
          opportunities_found: totalOpportunities,
        },
        { status: 502 }
      );
    }

    const postById = new Map(batch.map((p) => [p.id, p]));
    const opportunitiesToInsert = [];
    const evaluatedToInsert = [];

    for (const evalItem of evaluations) {
      evaluatedToInsert.push({ user_id: user.id, agent_id: agentId, source_post_id: evalItem.post_id });

      const post = postById.get(evalItem.post_id);
      if (!post || !evalItem.relevant) continue;

      opportunitiesToInsert.push({
        user_id: user.id,
        agent_id: agentId,
        source_post_id: post.id,
        platform: post.platform,
        author_name: post.author_name,
        author_profile_url: post.author_profile_url,
        post_url: post.post_url,
        location_mentioned: evalItem.location_mentioned,
        phone_number: evalItem.phone_number,
        content: post.raw_text,
        category: evalItem.category,
        intent_score: evalItem.intent_score,
        urgency: evalItem.urgency,
        estimated_value: evalItem.estimated_value,
        ai_summary: evalItem.ai_summary,
        status: "new",
      });
    }

    if (evaluatedToInsert.length > 0) {
      const { error } = await supabase
        .from("evaluated_posts")
        .upsert(evaluatedToInsert, { onConflict: "agent_id,source_post_id" });
      if (error) {
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            scraped,
            scrape_log: scrapeLog,
            evaluated: totalEvaluated,
            opportunities_found: totalOpportunities,
          },
          { status: 500 }
        );
      }
    }

    if (opportunitiesToInsert.length > 0) {
      const { error } = await supabase.from("opportunities").insert(opportunitiesToInsert);
      if (error) {
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            scraped,
            scrape_log: scrapeLog,
            evaluated: totalEvaluated,
            opportunities_found: totalOpportunities,
          },
          { status: 500 }
        );
      }
    }

    totalEvaluated += batch.length;
    totalOpportunities += opportunitiesToInsert.length;
  }

  return NextResponse.json({
    success: true,
    scraped,
    scrape_log: scrapeLog,
    evaluated: totalEvaluated,
    opportunities_found: totalOpportunities,
  });
}
