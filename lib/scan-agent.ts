import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluatePostsForAgent, type AgentProfile, type RawPostInput } from "@/lib/ai";

// Posts per Gemini request. Larger batches mean fewer total requests (less
// time spent on inter-batch pacing below) — these are short social posts, so
// even 100 of them per call is nowhere near Gemini's 1M-token context window.
const BATCH_SIZE = 100;
const MAX_POSTS_PER_SCAN = 500;
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

export interface EvaluateAgentResult {
  evaluated: number;
  opportunitiesFound: number;
  message?: string;
}

/**
 * Evaluates every not-yet-evaluated post (within rangeDays) against one
 * agent's profile and stores any resulting opportunities. Shared by the
 * interactive "Scan for Opportunities" button (app/api/agents/[id]/scan)
 * and the unattended cron auto-scan route — both scrape-then-evaluate or
 * (for cron, which can't run Playwright on Vercel) evaluate-only.
 *
 * Callers pass an explicit userId used to scope every query, so this works
 * identically whether `supabase` is a user-scoped RLS client (interactive
 * route) or a service-role client with RLS bypassed (cron route iterating
 * many users' agents).
 */
export async function evaluateAgentPosts(
  supabase: SupabaseClient,
  agent: AgentProfile,
  userId: string,
  rangeDays: number
): Promise<EvaluateAgentResult> {
  const cutoffIso = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: evaluatedRows } = await supabase
    .from("evaluated_posts")
    .select("source_post_id")
    .eq("agent_id", agent.id);
  const evaluatedIds = new Set((evaluatedRows ?? []).map((r) => r.source_post_id));

  // Posts with a parsed timestamp are filtered by that; posts where we couldn't
  // parse a relative age from the page (posted_at is null) fall back to when we
  // scraped them, so they aren't silently excluded from every range.
  const { data: allPosts } = await supabase
    .from("posts")
    .select("id, platform, author_name, author_profile_url, post_url, raw_text")
    .eq("user_id", userId)
    .or(`posted_at.gte.${cutoffIso},and(posted_at.is.null,scraped_at.gte.${cutoffIso})`)
    .order("scraped_at", { ascending: false })
    .limit(MAX_POSTS_PER_SCAN);

  const unevaluated = ((allPosts ?? []) as PostRow[]).filter((p) => !evaluatedIds.has(p.id));

  if (unevaluated.length === 0) {
    return {
      evaluated: 0,
      opportunitiesFound: 0,
      message: `No new posts in the last ${rangeDays} day${rangeDays === 1 ? "" : "s"} to evaluate.`,
    };
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
      evaluations = await evaluatePostsForAgent(agent, postsForAI);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI evaluation failed";
      throw new Error(
        `${message} (evaluated ${totalEvaluated} of ${unevaluated.length} posts before this failure — already-found opportunities were saved)`
      );
    }

    const opportunitiesToInsert: {
      user_id: string;
      agent_id: string;
      source_post_id: string;
      platform: string;
      author_name: string;
      author_profile_url: string | null;
      post_url: string | null;
      location_mentioned: string | null;
      phone_number: string | null;
      content: string;
      category: string;
      intent_score: number;
      urgency: string;
      estimated_value: string;
      ai_summary: string;
      status: string;
    }[] = [];
    const evaluatedToInsert: { user_id: string; agent_id: string; source_post_id: string }[] = [];

    // Match evaluations back to posts by array position, not by the post_id
    // Gemini echoes in its JSON — the system instruction in lib/ai.ts already
    // guarantees "one object per input post, in the same order," so position
    // is a reliable match. The echoed string isn't: LLMs occasionally corrupt
    // long hyphenated UUIDs when asked to copy them verbatim (observed live —
    // a real ID lost 4 chars + a dash in transit), and that corrupted string
    // was being inserted directly as source_post_id, a uuid column — Postgres
    // rejects it, and because these are batch upserts, one bad id failed the
    // *entire* batch, silently losing every real opportunity found alongside
    // it. Only ever use batch[idx].id (the trusted DB value) as the FK.
    evaluations.forEach((evalItem, idx) => {
      const post = batch[idx];
      if (!post) return; // Gemini returned more items than posts sent in this batch

      evaluatedToInsert.push({ user_id: userId, agent_id: agent.id, source_post_id: post.id });

      if (!evalItem.relevant) return;

      opportunitiesToInsert.push({
        user_id: userId,
        agent_id: agent.id,
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
    });

    if (evaluatedToInsert.length > 0) {
      const { error } = await supabase
        .from("evaluated_posts")
        .upsert(evaluatedToInsert, { onConflict: "agent_id,source_post_id" });
      if (error) throw new Error(error.message);
    }

    if (opportunitiesToInsert.length > 0) {
      const { error } = await supabase.from("opportunities").insert(opportunitiesToInsert);
      if (error) throw new Error(error.message);
    }

    totalEvaluated += batch.length;
    totalOpportunities += opportunitiesToInsert.length;
  }

  return { evaluated: totalEvaluated, opportunitiesFound: totalOpportunities };
}

export type { AgentProfile };
