import { NextResponse } from "next/server";
import leadsDb from "@/lib/db";
import { db as opportunityDb } from "@/lib/db/schema";
import { evaluatePostsForAgent, type AgentProfile, type RawPostInput } from "@/lib/ai";

const BATCH_SIZE = 25;

interface PostRow {
  id: number;
  platform: string;
  author_name: string;
  author_profile_url: string | null;
  post_url: string | null;
  raw_text: string;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);

  if (!Number.isFinite(agentId)) {
    return NextResponse.json({ success: false, error: "Invalid agent id" }, { status: 400 });
  }

  const agent = opportunityDb.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as
    | AgentProfile
    | undefined;

  if (!agent) {
    return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
  }

  const evaluatedRows = opportunityDb
    .prepare("SELECT source_post_id FROM evaluated_posts WHERE agent_id = ?")
    .all(agentId) as { source_post_id: number }[];
  const evaluatedIds = new Set(evaluatedRows.map((r) => r.source_post_id));

  const allPosts = leadsDb
    .prepare(
      `SELECT id, platform, author_name, author_profile_url, post_url, raw_text
       FROM posts ORDER BY scraped_at DESC LIMIT 300`
    )
    .all() as PostRow[];

  const unevaluated = allPosts.filter((p) => !evaluatedIds.has(p.id)).slice(0, BATCH_SIZE);

  if (unevaluated.length === 0) {
    return NextResponse.json({
      success: true,
      evaluated: 0,
      opportunities_found: 0,
      message: "No new posts to evaluate — everything collected so far has already been scanned.",
    });
  }

  const postsForAI: RawPostInput[] = unevaluated.map((p) => ({
    post_id: p.id,
    platform: p.platform,
    author_name: p.author_name,
    raw_text: p.raw_text,
    post_url: p.post_url,
    author_profile_url: p.author_profile_url,
  }));

  let evaluations;
  try {
    evaluations = await evaluatePostsForAgent(agent, postsForAI);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI evaluation failed";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }

  const postById = new Map(unevaluated.map((p) => [p.id, p]));

  const insertOpportunity = opportunityDb.prepare(`
    INSERT INTO opportunities
      (agent_id, source_post_id, platform, author_name, author_profile_url, post_url, location_mentioned, content, category, intent_score, urgency, estimated_value, ai_summary, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
  `);
  const markEvaluated = opportunityDb.prepare(
    "INSERT OR IGNORE INTO evaluated_posts (agent_id, source_post_id) VALUES (?, ?)"
  );

  let opportunitiesFound = 0;

  const persist = opportunityDb.transaction((evals: typeof evaluations) => {
    for (const evalItem of evals) {
      markEvaluated.run(agentId, evalItem.post_id);
      const post = postById.get(evalItem.post_id);
      if (!post || !evalItem.relevant) continue;

      insertOpportunity.run(
        agentId,
        post.id,
        post.platform,
        post.author_name,
        post.author_profile_url,
        post.post_url,
        evalItem.location_mentioned,
        post.raw_text,
        evalItem.category,
        evalItem.intent_score,
        evalItem.urgency,
        evalItem.estimated_value,
        evalItem.ai_summary
      );
      opportunitiesFound++;
    }
  });
  persist(evaluations);

  return NextResponse.json({
    success: true,
    evaluated: unevaluated.length,
    opportunities_found: opportunitiesFound,
  });
}
