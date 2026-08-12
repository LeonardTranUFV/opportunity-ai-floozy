import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The Shared Opportunity Pool — the only place in this app that reads across
 * user boundaries.
 *
 * Everything else is protected by RLS (`auth.uid() = user_id`). This is not,
 * because it cannot be: it deliberately returns other people's rows. So the
 * guarantees are enforced here instead, and they are worth stating because a
 * mistake in this file leaks a customer's leads to a competitor:
 *
 *   1. The caller must hold `pool_access`. Checked against the caller's OWN
 *      session-scoped client, never a flag from the request body.
 *   2. Only opted-in users' rows are ever returned. This reads the
 *      `pooled_opportunities` view, which resolves the consent join in SQL, so
 *      a caller here cannot forget the WHERE clause. Never query
 *      `opportunities` directly from this file.
 *   3. Every read is logged before rows are returned, and a read whose log
 *      write fails is refused. That includes the case where the migration has
 *      not been applied and the table does not exist — the feature must be
 *      unavailable rather than silently unaudited. This project has already
 *      shipped one check that failed open; this one fails closed.
 */

export type PoolFilters = {
  category?: string;
  location?: string;
  minScore?: number;
  limit?: number;
};

export type PoolRow = {
  id: string;
  user_id: string;
  platform: string | null;
  author_name: string | null;
  post_url: string | null;
  location_mentioned: string | null;
  phone_number: string | null;
  content: string;
  category: string | null;
  intent_score: number | null;
  urgency: string | null;
  ai_summary: string | null;
  created_at: string;
  /** True when the row belongs to the caller — their own lead, not a pooled one. */
  is_own: boolean;
};

/**
 * Whether this account may read the pool. `pool_access` is granted by an admin
 * and is separate from `is_admin` on purpose, so an agency client can be given
 * read access without also being able to grant it to anyone else.
 */
export async function hasPoolAccess(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", ["pool_access", "is_admin"]);

  return (data ?? []).some((r) => r.value === "true");
}

/**
 * Writes the audit record. Returns false if it could not be written — the
 * caller MUST treat that as a denial, not a warning.
 */
async function logAccess(
  admin: SupabaseClient,
  viewerId: string,
  action: string,
  rows: number,
  note: string
): Promise<boolean> {
  const { error } = await admin.from("pool_access_log").insert({
    viewer_id: viewerId,
    action,
    rows_returned: rows,
    query_note: note.slice(0, 500),
  });
  if (error) {
    console.error("[pool] refusing read — audit log write failed:", error.message);
    return false;
  }
  return true;
}

export type PoolResult =
  | { ok: true; rows: PoolRow[]; contributors: number }
  | { ok: false; reason: "forbidden" | "unaudited" | "error"; message: string };

export async function readPool(
  supabase: SupabaseClient,
  userId: string,
  filters: PoolFilters = {}
): Promise<PoolResult> {
  if (!(await hasPoolAccess(supabase, userId))) {
    return { ok: false, reason: "forbidden", message: "This account cannot read the pool." };
  }

  const admin = createAdminClient();
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);

  let query = admin
    .from("pooled_opportunities")
    .select(
      "id,user_id,platform,author_name,post_url,location_mentioned,phone_number,content,category,intent_score,urgency,ai_summary,created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.minScore != null) query = query.gte("intent_score", filters.minScore);
  // PostgREST treats , ( ) * as operators inside a filter value — the same
  // escaping bug already fixed on the Opportunities search.
  if (filters.location) query = query.ilike("location_mentioned", `%${filters.location.replace(/[,()*]/g, "")}%`);

  const { data, error } = await query;
  if (error) {
    // A missing view means migration 0009 has not been applied. Say so plainly
    // rather than returning an empty pool, which reads as "no leads yet".
    const missing = /pooled_opportunities/.test(error.message);
    return {
      ok: false,
      reason: "error",
      message: missing
        ? "The pool is not set up yet — migration 0009_opportunity_pool.sql has not been applied."
        : error.message,
    };
  }

  const rows = (data ?? []) as Omit<PoolRow, "is_own">[];

  const note = JSON.stringify({ ...filters, limit });
  if (!(await logAccess(admin, userId, "list", rows.length, note))) {
    return {
      ok: false,
      reason: "unaudited",
      message:
        "The pool could not be read because the access log is unavailable. Reads are refused when they cannot be recorded.",
    };
  }

  return {
    ok: true,
    rows: rows.map((r) => ({ ...r, is_own: r.user_id === userId })),
    contributors: new Set(rows.map((r) => r.user_id)).size,
  };
}
