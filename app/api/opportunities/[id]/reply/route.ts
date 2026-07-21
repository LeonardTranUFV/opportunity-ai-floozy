import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateReply, type AgentProfile } from "@/lib/ai";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();

  const body = await request.json().catch(() => ({}));
  const tone = body.tone || "professional";

  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, agent_id, author_name, content, platform")
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

  let reply: string;
  try {
    reply = await generateReply(
      agent as AgentProfile,
      { author_name: opportunity.author_name, raw_text: opportunity.content, platform: opportunity.platform },
      tone
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI reply generation failed";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }

  await supabase.from("opportunities").update({ suggested_reply: reply }).eq("id", opportunityId);

  return NextResponse.json({ success: true, reply });
}
