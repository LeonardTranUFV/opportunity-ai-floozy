import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluatePostsForAgent, type AgentProfile, type RawPostInput } from "@/lib/ai";
import { CREDIT_COSTS, hasCredits, spendCredits, InsufficientCreditsError } from "@/lib/credits";
import { filterPostsForAgent, describeFilter } from "@/lib/post-filter";

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
  /** Every post resolved this run, whether by the AI or by the local filter. */
  evaluated: number;
  opportunitiesFound: number;
  /** Posts resolved locally for free — never sent to Gemini, never charged. */
  locallyFiltered: number;
  /** Gemini requests actually made. This is what the run cost. */
  aiCalls: number;
  message?: string;
  /**
   * Posts left unevaluated because the run ran out of time, or 0 if it
   * finished. Nothing is lost when this is non-zero — evaluated_posts records
   * what was already scored, so the next run resumes rather than repeats.
   */
  remaining?: number;
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
  rangeDays: number,
  /**
   * When this run must be finished, or null for no limit.
   *
   * A scan is a loop of Gemini calls with deliberate pacing between them, and
   * a customer with a few hundred fresh posts needs more of them than a
   * serverless invocation has seconds. Being killed partway through is the bad
   * ending: the response never arrives, and what the customer sees is "scan
   * failed" even though every batch that finished was saved and charged.
   *
   * Stopping early is the good one, and it costs nothing to resume:
   * evaluated_posts already records what has been scored, so the next run
   * picks up exactly where this one stopped.
   */
  deadline: number | null = null
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
      locallyFiltered: 0,
      aiCalls: 0,
      message: `No new posts in the last ${rangeDays} day${rangeDays === 1 ? "" : "s"} to evaluate.`,
    };
  }

  // Resolve everything that can be resolved for free before spending anything.
  // Because credits and free-tier quota are charged per batch of 100, this
  // doesn't just shrink each prompt — dropping enough posts removes whole
  // Gemini requests, along with the 6.5s of pacing each one costs.
  const filtered = filterPostsForAgent(agent, unevaluated);
  const toEvaluate = filtered.kept;
  const filterNote = describeFilter(filtered);
  const duplicateCount = [...filtered.duplicates.values()].reduce((sum, g) => sum + g.length, 0);

  // Locally-rejected posts are recorded as evaluated immediately. Without this
  // they'd be reconsidered on every future scan forever, and the filter would
  // save nothing on the second run.
  const locallyResolved = filtered.rejected.map(({ post }) => post);
  if (locallyResolved.length > 0) {
    const { error } = await supabase.from("evaluated_posts").upsert(
      locallyResolved.map((p) => ({ user_id: userId, agent_id: agent.id, source_post_id: p.id })),
      { onConflict: "agent_id,source_post_id" }
    );
    if (error) throw new Error(error.message);
  }

  if (toEvaluate.length === 0) {
    return {
      evaluated: locallyResolved.length,
      opportunitiesFound: 0,
      locallyFiltered: locallyResolved.length,
      aiCalls: 0,
      message:
        filterNote ??
        `No new posts in the last ${rangeDays} day${rangeDays === 1 ? "" : "s"} to evaluate.`,
    };
  }

  let totalEvaluated = locallyResolved.length;
  let totalOpportunities = 0;
  let aiCalls = 0;
  let remaining = 0;

  /**
   * What one more batch costs, so the loop can stop *before* starting one it
   * cannot finish rather than discovering that by being killed.
   *
   * The floor covers a Gemini call plus the pacing sleep before it. After the
   * first batch the measured time replaces it, so a slow model response or a
   * retry makes the next check more cautious on its own.
   */
  const PER_BATCH_FLOOR_MS = BATCH_PACING_MS + 12_000;
  let slowestBatchMs = 0;

  // Walk every unevaluated post in AI-request-sized batches — a single scan
  // click used to silently stop after the first 25 posts regardless of how
  // many more were waiting, which made "scan everything" impossible without
  // repeated manual clicks.
  for (let i = 0; i < toEvaluate.length; i += BATCH_SIZE) {
    if (deadline !== null && Date.now() + Math.max(PER_BATCH_FLOOR_MS, slowestBatchMs) > deadline) {
      remaining = toEvaluate.length - i;
      break;
    }
    const batchStartedAt = Date.now();
    if (i > 0) await sleep(BATCH_PACING_MS);
    const batch = toEvaluate.slice(i, i + BATCH_SIZE);

    // Check credits before spending real Gemini cost on this batch — not
    // after, since a customer with 0 credits shouldn't cause an API call at
    // all. Deduction itself happens only after a successful evaluation
    // (below), same "only charge for what actually worked" principle as the
    // rest of this function's error handling.
    if (!(await hasCredits(supabase, userId, CREDIT_COSTS.scanBatch))) {
      if (totalEvaluated > 0) break; // keep whatever was already found this run
      throw new InsufficientCreditsError();
    }

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
    aiCalls += 1;

    await spendCredits(supabase, userId, CREDIT_COSTS.scanBatch, "scan_batch", {
      agent_id: agent.id,
      batch_size: batch.length,
    });

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

    // Match each verdict back to a post the model never saw the id of. The
    // wire format (lib/ai.ts) sends a small 1-based "i" per post instead of
    // the row's UUID, precisely because LLMs corrupt long hyphenated ids when
    // asked to copy them verbatim (observed live — a real id lost 4 chars and
    // a dash in transit, and since these are batch upserts, that one bad FK
    // failed the *entire* batch and silently lost every real opportunity
    // alongside it). A 1-3 digit integer survives the round trip, so it's now
    // safe to trust the echo for *ordering* — while still never letting it
    // near the FK, which always comes from the trusted DB row.
    //
    // Trusting the echoed index is strictly better than trusting position:
    // if the model omits one item mid-array, every later verdict shifts up by
    // one under position-matching and gets written to the wrong post. The
    // index catches that. Position remains the fallback for a missing or
    // out-of-range echo.
    const claimed = new Set<number>();
    evaluations.forEach((evalItem, idx) => {
      const echoed = Number.isInteger(evalItem?.index) ? evalItem.index - 1 : NaN;
      const slot = !Number.isNaN(echoed) && echoed >= 0 && echoed < batch.length ? echoed : idx;

      // Two verdicts pointing at the same post means the response is
      // scrambled; writing either one risks attaching a verdict to unrelated
      // content, so drop the later claim and leave that post unevaluated for
      // the next run to retry.
      if (claimed.has(slot)) return;
      const post = batch[slot];
      if (!post) return; // more verdicts came back than posts were sent
      claimed.add(slot);

      // Posts whose text was identical to this one were never sent — one
      // verdict answers for all of them. They still get their own rows, since
      // each has its own author, permalink and platform to act on.
      const twins = filtered.duplicates.get(post.id) ?? [];
      for (const p of [post, ...twins]) {
        evaluatedToInsert.push({ user_id: userId, agent_id: agent.id, source_post_id: p.id });

        if (!evalItem.relevant) continue;

        opportunitiesToInsert.push({
          user_id: userId,
          agent_id: agent.id,
          source_post_id: p.id,
          platform: p.platform,
          author_name: p.author_name,
          author_profile_url: p.author_profile_url,
          post_url: p.post_url,
          location_mentioned: evalItem.location_mentioned,
          phone_number: evalItem.phone_number,
          content: p.raw_text,
          category: evalItem.category,
          intent_score: evalItem.intent_score,
          urgency: evalItem.urgency,
          estimated_value: evalItem.estimated_value,
          ai_summary: evalItem.ai_summary,
          status: "new",
        });
      }
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

    // Count what was actually resolved, not the batch size — this includes the
    // duplicate posts that rode along on a verdict, and excludes any slot the
    // model failed to answer for.
    totalEvaluated += evaluatedToInsert.length;
    totalOpportunities += opportunitiesToInsert.length;
    slowestBatchMs = Math.max(slowestBatchMs, Date.now() - batchStartedAt);
  }

  // Said plainly, because "scanned 200" with 400 still waiting looks like the
  // scan decided those 400 weren't worth reading.
  const timeNote =
    remaining > 0
      ? `Stopped with ${remaining} post${remaining === 1 ? "" : "s"} still to check — scan again to carry on from here.`
      : null;

  return {
    evaluated: totalEvaluated,
    opportunitiesFound: totalOpportunities,
    // Both kinds of post skipped the API: the ones rejected outright, and the
    // duplicates that a single verdict answered for.
    locallyFiltered: locallyResolved.length + duplicateCount,
    aiCalls,
    message: [filterNote, timeNote].filter(Boolean).join(" ") || undefined,
    remaining,
  };
}

export type { AgentProfile };
