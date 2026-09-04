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
 * grows with the customer count. It no longer times out — agents it cannot
 * reach keep their timestamps and go first next tick — but more room means
 * fewer customers waiting an extra hour, and nobody is watching a spinner
 * here.
 */
export const maxDuration = 300;

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

  /**
   * This loop covers every due agent across every account inside one
   * invocation, so it is the first thing here that will outgrow its time as
   * customers are added — and being killed means the agents already scanned
   * never get their last_auto_scan_at written, so the next tick redoes them
   * and the tail is never reached.
   *
   * Each agent is given what remains, and an agent that cannot be started is
   * simply left for the next tick with its timestamp untouched, which is
   * exactly how it becomes first in line.
   */
  const deadline = Date.now() + (maxDuration * 1000 - 10_000);

  const results = [];
  let skippedForTime = 0;
  for (const agent of due) {
    if (Date.now() >= deadline) {
      skippedForTime++;
      continue;
    }
    try {
      const result = await evaluateAgentPosts(supabase, agent, agent.user_id, EVAL_RANGE_DAYS, deadline);
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

  return NextResponse.json({
    success: true,
    checked: (agents ?? []).length,
    ran: due.length - skippedForTime,
    skipped_for_time: skippedForTime,
    results,
  });
}
