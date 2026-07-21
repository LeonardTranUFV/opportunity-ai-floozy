import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { evaluatePostsForAgent, type AgentProfile, type RawPostInput } from "@/lib/ai";

const BATCH_SIZE = 25;

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

  const { data: evaluatedRows } = await supabase
    .from("evaluated_posts")
    .select("source_post_id")
    .eq("agent_id", agentId);
  const evaluatedIds = new Set((evaluatedRows ?? []).map((r) => r.source_post_id));

  const { data: allPosts } = await supabase
    .from("posts")
    .select("id, platform, author_name, author_profile_url, post_url, raw_text")
    .order("scraped_at", { ascending: false })
    .limit(300);

  const unevaluated = ((allPosts ?? []) as PostRow[])
    .filter((p) => !evaluatedIds.has(p.id))
    .slice(0, BATCH_SIZE);

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
    evaluations = await evaluatePostsForAgent(agent as AgentProfile, postsForAI);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI evaluation failed";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }

  const postById = new Map(unevaluated.map((p) => [p.id, p]));

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
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  }

  if (opportunitiesToInsert.length > 0) {
    const { error } = await supabase.from("opportunities").insert(opportunitiesToInsert);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    evaluated: unevaluated.length,
    opportunities_found: opportunitiesToInsert.length,
  });
}
