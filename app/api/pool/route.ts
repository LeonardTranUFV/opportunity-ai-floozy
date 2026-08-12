import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { readPool } from "@/lib/pool";

/**
 * Reads the Shared Opportunity Pool.
 *
 * This is the one endpoint in the app that can return another user's rows, so
 * it fails closed at every step: no session → 401, no `pool_access` → 403, no
 * audit record → 503. The consent filter is not applied here; it lives in the
 * `pooled_opportunities` view so it cannot be omitted by a caller.
 *
 * Rate-limited on the `strict` bucket rather than `standard`: the risk being
 * limited is a granted account quietly exfiltrating the whole pool, not cost.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit(`pool:${user.id}`, LIMITS.pool.limit, LIMITS.pool.windowMs);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many pool reads. Try again shortly." },
      { status: 429 }
    );
  }

  const url = new URL(request.url);
  const num = (k: string) => {
    const v = url.searchParams.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const result = await readPool(supabase, user.id, {
    category: url.searchParams.get("category") ?? undefined,
    location: url.searchParams.get("location") ?? undefined,
    minScore: num("minScore"),
    limit: num("limit"),
  });

  if (!result.ok) {
    const status =
      result.reason === "forbidden" ? 403 : result.reason === "unaudited" ? 503 : 500;
    return NextResponse.json({ error: result.message }, { status });
  }

  return NextResponse.json({
    opportunities: result.rows,
    contributors: result.contributors,
    count: result.rows.length,
  });
}
