import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateOutreachDrafts, type AgentProfile, type BusinessProfile, type OutreachDrafts } from "@/lib/ai";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, agent_id, author_name, content, platform, suggested_comment, suggested_dm")
    .eq("id", opportunityId)
    .single();

  if (oppError || !opportunity) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("*")
    .eq("id", opportunity.agent_id)
    .single();

  if (agentError || !agent) {
    return NextResponse.json(
      { success: false, error: "Agent for this opportunity no longer exists" },
      { status: 404 }
    );
  }

  const { data: settingsRows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["business_owner_name", "business_name", "business_phone", "business_pitch"]);
  const settingsMap = Object.fromEntries((settingsRows ?? []).map((r) => [r.key, r.value]));
  const businessProfile: BusinessProfile = {
    ownerName: settingsMap.business_owner_name || undefined,
    businessName: settingsMap.business_name || undefined,
    phone: settingsMap.business_phone || undefined,
    pitch: settingsMap.business_pitch || undefined,
  };

  const previousDraft: OutreachDrafts | undefined =
    opportunity.suggested_comment && opportunity.suggested_dm
      ? { comment: opportunity.suggested_comment, dm: opportunity.suggested_dm }
      : undefined;

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

  await supabase
    .from("opportunities")
    .update({ suggested_comment: drafts.comment, suggested_dm: drafts.dm })
    .eq("id", opportunityId);

  return NextResponse.json({ success: true, comment: drafts.comment, dm: drafts.dm });
}
