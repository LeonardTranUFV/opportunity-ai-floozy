import { NextResponse } from "next/server";
import { db as opportunityDb } from "@/lib/db/schema";
import { generateReply, type AgentProfile } from "@/lib/ai";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opportunityId = Number(id);

  if (!Number.isFinite(opportunityId)) {
    return NextResponse.json({ success: false, error: "Invalid opportunity id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const tone = body.tone || "professional";

  const opportunity = opportunityDb.prepare("SELECT * FROM opportunities WHERE id = ?").get(opportunityId) as
    | {
        id: number;
        agent_id: number;
        author_name: string;
        content: string;
        platform: string;
      }
    | undefined;

  if (!opportunity) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  const agent = opportunityDb.prepare("SELECT * FROM agents WHERE id = ?").get(opportunity.agent_id) as
    | AgentProfile
    | undefined;

  if (!agent) {
    return NextResponse.json({ success: false, error: "Agent for this opportunity no longer exists" }, { status: 404 });
  }

  let reply: string;
  try {
    reply = await generateReply(
      agent,
      { author_name: opportunity.author_name, raw_text: opportunity.content, platform: opportunity.platform },
      tone
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI reply generation failed";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }

  opportunityDb.prepare("UPDATE opportunities SET suggested_reply = ? WHERE id = ?").run(reply, opportunityId);

  return NextResponse.json({ success: true, reply });
}
