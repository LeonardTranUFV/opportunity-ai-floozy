import { NextResponse } from "next/server";
import { db as opportunityDb } from "@/lib/db/schema";

export async function GET() {
  try {
    const notifications = opportunityDb
      .prepare(
        `SELECT opportunities.id, opportunities.author_name, opportunities.ai_summary, opportunities.content,
                opportunities.urgency, opportunities.intent_score, opportunities.created_at,
                agents.name as agent_name
         FROM opportunities
         JOIN agents ON agents.id = opportunities.agent_id
         WHERE opportunities.status = 'new'
           AND (opportunities.urgency IN ('asap', 'high') OR opportunities.intent_score >= 80)
         ORDER BY opportunities.created_at DESC
         LIMIT 20`
      )
      .all();

    return NextResponse.json({ success: true, notifications, count: notifications.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load notifications";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
