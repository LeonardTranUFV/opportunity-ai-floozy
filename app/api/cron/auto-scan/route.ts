import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateAgentPosts, type AgentProfile } from "@/lib/scan-agent";

// Cron only evaluates posts already sitting in Supabase — it never scrapes.
// Two reasons: (1) scraping needs a real, visible Chrome window and a
// per-user persistent profile on disk, neither of which exists on Vercel's
// serverless runtime (see lib/deployment.ts); (2) scraping is scoped by the
// `groups` table with no user_id filter, relying on RLS to keep it
// per-user — the service-role client here bypasses RLS, so reusing that
// query as-is would scrape every user's groups under whichever user_id
// happened to be running. Evaluation only needs `posts.user_id`, which we
// filter explicitly, so it stays tenant-safe.
//
// Always evaluate a 1-day lookback regardless of the agent's own interval:
// evaluated_posts dedup makes re-checking the same window on every run free
// (already-scored posts are skipped), and 1 day comfortably covers the gap
// even for the 12-hour tier if a run gets skipped or delayed.
const EVAL_RANGE_DAYS = 1;

interface DueAgent extends AgentProfile {
  user_id: string;
  auto_scan_interval_hours: number;
  last_auto_scan_at: string | null;
}

function isDue(agent: DueAgent, now: number): boolean {
  if (!agent.last_auto_scan_at) return true;
  const elapsedMs = now - new Date(agent.last_auto_scan_at).getTime();
  return elapsedMs >= agent.auto_scan_interval_hours * 60 * 60 * 1000;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not set" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: agents, error } = await supabase
    .from("agents")
    .select("*")
    .not("auto_scan_interval_hours", "is", null);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const due = ((agents ?? []) as DueAgent[]).filter((a) => isDue(a, now));

  const results = [];
  for (const agent of due) {
    try {
      const result = await evaluateAgentPosts(supabase, agent, agent.user_id, EVAL_RANGE_DAYS);
      await supabase
        .from("agents")
        .update({ last_auto_scan_at: new Date().toISOString() })
        .eq("id", agent.id);
      results.push({ agent_id: agent.id, name: agent.name, ...result });
    } catch (err) {
      results.push({
        agent_id: agent.id,
        name: agent.name,
        error: err instanceof Error ? err.message : "Auto-scan failed",
      });
    }
  }

  return NextResponse.json({ success: true, checked: (agents ?? []).length, ran: due.length, results });
}
