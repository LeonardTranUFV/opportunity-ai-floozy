import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Checks admin status via the `settings` table (same generic per-user
 * key/value pattern used everywhere else in this app — see
 * app/api/settings/route.ts). Must always be checked against the CALLER's
 * own session-scoped client, never trusted from a client-supplied flag —
 * the whole point is that a regular customer can't just claim to be an
 * admin.
 */
export async function isAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "is_admin")
    .maybeSingle();
  return data?.value === "true";
}
