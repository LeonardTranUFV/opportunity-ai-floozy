import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateOutreachDrafts, type AgentProfile, type BusinessProfile, type OutreachDrafts } from "@/lib/ai";
import { CREDIT_COSTS, hasCredits, spendCredits, outOfCreditsError } from "@/lib/credits";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import { loadBusinessProfile, loadCompanyProfile } from "@/lib/company-profile";
import { tradeAgent } from "@/lib/lead-matcher";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`reply-gen:${user.id}`, LIMITS.ai.limit, LIMITS.ai.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "draft generations");

  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, agent_id, author_name, content, platform, suggested_comment, suggested_dm")
    .eq("id", opportunityId)
    .single();

  if (oppError || !opportunity) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  /**
   * A lead Floozy found in an area group (source_kind 'floozy', see
   * lib/lead-matcher.ts) has no agent of the client's own. The draft is written
   * as the client's business in their first trade instead.
   */
  let agent: AgentProfile | null = null;
  let agentError: unknown = null;
  if (opportunity.agent_id) {
    const found = await supabase.from("agents").select("*").eq("id", opportunity.agent_id).single();
    agent = found.data as AgentProfile | null;
    agentError = found.error;
  } else {
    const { profile } = await loadCompanyProfile(supabase, user.id);
    const base = tradeAgent(profile.trades[0] ?? "general-contractor", null);
    agent = { ...base, name: profile.businessName || base.name };
  }

  if (agentError || !agent) {
    return NextResponse.json(
      { success: false, error: "Agent for this opportunity no longer exists" },
      { status: 404 }
    );
  }

  const businessProfile: BusinessProfile = await loadBusinessProfile(supabase, user.id);

  const previousDraft: OutreachDrafts | undefined =
    opportunity.suggested_comment && opportunity.suggested_dm
      ? { comment: opportunity.suggested_comment, dm: opportunity.suggested_dm }
      : undefined;

  if (!(await hasCredits(supabase, user.id, CREDIT_COSTS.draftGeneration))) {
    return NextResponse.json(
      { success: false, error: (await outOfCreditsError(supabase, user.id)).message },
      { status: 402 }
    );
  }

  let drafts;
  try {
    drafts = await generateOutreachDrafts(
      agent as AgentProfile,
      { author_name: opportunity.author_name, raw_text: opportunity.content, platform: opportunity.platform },
      businessProfile,
      previousDraft
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI reply generation failed";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }

  await spendCredits(supabase, user.id, CREDIT_COSTS.draftGeneration, "draft_generation", {
    opportunity_id: opportunityId,
  });

  await supabase
    .from("opportunities")
    .update({ suggested_comment: drafts.comment, suggested_dm: drafts.dm })
    .eq("id", opportunityId);

  return NextResponse.json({ success: true, comment: drafts.comment, dm: drafts.dm });
}
