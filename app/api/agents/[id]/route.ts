import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

/**
 * Editing an agent.
 *
 * This used to accept one field, `auto_scan_interval_hours`, and answer
 * "Nothing to update" to everything else — so an agent's trade, area and
 * keywords were fixed at creation, and the only way to fix a typo was to
 * delete the agent, which takes every opportunity hanging off it with it.
 *
 * The keyword fields are the ones worth being able to change: an agent that
 * finds nothing is nearly always one whose keywords are too narrow, and that
 * is only discoverable after it has run for a day.
 */

const ALLOWED_INTERVALS = [1, 4, 12];
const TEXT_LIMITS: Record<string, number> = {
  name: 120,
  goal: 4000,
  location: 500,
  keywords: 2000,
  negative_keywords: 2000,
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`agents-update:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "updates");

  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if ("auto_scan_interval_hours" in body) {
    const raw = body.auto_scan_interval_hours;
    if (raw !== null && !ALLOWED_INTERVALS.includes(raw)) {
      return NextResponse.json({ success: false, error: "Invalid auto_scan_interval_hours" }, { status: 400 });
    }
    updates.auto_scan_interval_hours = raw;
  }

  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (typeof raw !== "string") {
      return NextResponse.json({ success: false, error: `${field} must be text.` }, { status: 400 });
    }
    const value = raw.trim();
    if (value.length > max) {
      return NextResponse.json(
        { success: false, error: `That ${field.replace(/_/g, " ")} is too long.` },
        { status: 400 }
      );
    }
    // name and goal are what every screen identifies the agent by; the rest
    // may legitimately be cleared.
    if (!value && (field === "name" || field === "goal")) {
      return NextResponse.json({ success: false, error: `An agent needs a ${field}.` }, { status: 400 });
    }
    updates[field] = value || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, error: "Nothing to update" }, { status: 400 });
  }

  // Scoped to the owner explicitly as well as by RLS: this route is one
  // missing `.eq()` away from editing somebody else's agent if a policy is
  // ever loosened, and saying so here costs nothing.
  const { error } = await supabase.from("agents").update(updates).eq("id", id).eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
