import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import { getSourceCapacity, countsTowardSourceLimit } from "@/lib/entitlement";

/**
 * Resume, pause or delete several sources in one request.
 *
 * The per-row buttons could do this by being clicked forty times, and that is
 * roughly what it took to recover after the weekly resync used to pause
 * everything. Forty requests is also forty chances to trip the rate limiter
 * half way through and leave the list in a state nobody chose, which is worse
 * than slow.
 *
 * Resuming is the only action that can exceed the plan's limit, and it is
 * handled the same way the single-source route handles it: fill the remaining
 * capacity, oldest first, and say plainly how many were left off. Refusing the
 * whole batch because one source over the line would be technically correct
 * and useless — the customer asked for as much as they are allowed.
 */

type Action = "activate" | "pause" | "delete";
const ACTIONS: Action[] = ["activate", "pause", "delete"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`groups-bulk:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "updates");

  let ids: string[];
  let action: Action;
  try {
    const body = (await request.json()) as { ids?: unknown; action?: unknown };
    ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === "string") : [];
    action = ACTIONS.includes(body.action as Action) ? (body.action as Action) : ("" as Action);
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!ids.length) return NextResponse.json({ error: "Nothing selected." }, { status: 400 });
  if (!action) {
    return NextResponse.json({ error: `action must be one of: ${ACTIONS.join(", ")}` }, { status: 400 });
  }
  // A ceiling rather than a guess at what is reasonable. Without one, a
  // crafted request turns a convenience endpoint into an unbounded statement.
  if (ids.length > 200) {
    return NextResponse.json({ error: "Too many sources in one request (max 200)." }, { status: 400 });
  }

  // Read what we are about to touch, scoped to the caller by RLS. This is also
  // what stops an id from someone else's account being included in the list.
  const { data: targets, error: readError } = await supabase
    .from("groups")
    .select("id, platform, active")
    .in("id", ids)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  const owned = targets ?? [];
  if (!owned.length) return NextResponse.json({ error: "Nothing selected." }, { status: 400 });

  if (action === "delete") {
    const { error } = await supabase.from("groups").delete().in("id", owned.map((g) => g.id)).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: owned.length });
  }

  if (action === "pause") {
    const toPause = owned.filter((g) => g.active).map((g) => g.id);
    if (toPause.length) {
      const { error } = await supabase.from("groups").update({ active: false }).in("id", toPause).eq("user_id", user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, paused: toPause.length });
  }

  // ── activate ────────────────────────────────────────────────────────────
  const capacity = await getSourceCapacity(supabase, user.id);
  const candidates = owned.filter((g) => !g.active);

  // Free sources first: they cost nothing against the limit, so switching them
  // on can never be the reason another one is refused.
  const free = candidates.filter((g) => !countsTowardSourceLimit(g.platform));
  const counted = candidates.filter((g) => countsTowardSourceLimit(g.platform));
  const room = capacity.unlimited ? counted.length : Math.max(0, capacity.remaining);
  const admitted = counted.slice(0, room);
  const overflow = counted.length - admitted.length;

  const toActivate = [...free, ...admitted].map((g) => g.id);
  if (toActivate.length) {
    const { error } = await supabase.from("groups").update({ active: true }).in("id", toActivate).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    activated: toActivate.length,
    overflow,
    message:
      overflow > 0
        ? `Resumed ${toActivate.length}. ${overflow} stayed paused — your plan reads ${capacity.limit} sources at a time. Pause something else or upgrade to bring the rest back.`
        : null,
  });
}
