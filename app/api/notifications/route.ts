import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  try {
    const { data: notifications, error } = await supabase
      .from("opportunities")
      .select("id, author_name, ai_summary, content, urgency, intent_score, created_at, agents(name)")
      .eq("status", "new")
      .or("urgency.in.(asap,high),intent_score.gte.80")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    const flattened = (notifications ?? []).map((n) => {
      const agent = Array.isArray(n.agents) ? n.agents[0] : n.agents;
      return { ...n, agent_name: agent?.name ?? "Unknown agent", agents: undefined };
    });

    return NextResponse.json({ success: true, notifications: flattened, count: flattened.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load notifications";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
