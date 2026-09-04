import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateAgentPosts, type AgentProfile } from "@/lib/scan-agent";

// Cron only evaluates posts already sitting in Supabase — it never scrapes.
//
// Both original reasons for that have since gone away, and neither is why it
// still holds. Scraping no longer needs a Chrome window on somebody's desk
// (openPlatformContext rents one), and scrapeAndStorePosts now filters groups
// by user_id explicitly rather than trusting RLS, so calling it with this
// route's service-role client would no longer crawl every customer's sources
// under one account.
//
// What is left is a cost decision, not a technical one. A rented browser bills
// by the minute; scraping here would put every customer's crawl on a clock
// nobody clicked, and this route already loops over every due agent across
// every account inside one 60-second invocation. Turning it on means deciding
// how many customers a tick may crawl and what that costs per month — an
// answer the operator has to give, not one to arrive at by default.
//
// Until then: collection happens when someone opens the app and scans. This
// route keeps finding opportunities in posts already collected.
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

/**
 * This route loops over every due agent across every account, so its runtime
 * grows with the customer count — the one most likely to reach the cap as
 * testers are added. If it starts timing out, the fix is spreading agents
 * across runs, not a bigger number.
 */
export const maxDuration = 60;

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
