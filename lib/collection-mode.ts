import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which accounts are crawled from the operator's PC instead of the cloud.
 *
 * Two collection paths exist and they are not equally safe. The hosted one
 * rents a browser from a datacentre, loads a fresh context and injects the
 * stored cookies; the local one (RUN-WORKER.bat) drives real Chrome from a
 * residential connection. The platforms score IP reputation far more heavily
 * than page behaviour — see StartSessionOptions.proxyId — and the difference
 * showed up in practice: the operator's own Facebook account ran two months
 * without a warning while collection was local, then drew "We suspect
 * automated behaviour on your account" within days of moving to the cloud.
 *
 * So an account can be marked to collect locally, and the hosted deployment
 * then refuses to open a browser for it at all. That is the whole guarantee:
 * with the flag set, every Facebook request for that account leaves from the
 * worker's machine or it does not happen. Clients stay on the cloud path by
 * default and nothing about them changes.
 *
 * Stored as a `settings` row rather than a column, for the reason
 * GROUPS_REFRESHED_AT_KEY gives: migrations here are applied by hand, and a new
 * column means the check silently fails until somebody runs the SQL. It is not
 * on the settings route's WRITABLE_KEYS, so a customer cannot set it through
 * the app; it is an operator decision made with the service role.
 */
export const COLLECTION_MODE_KEY = "collection_mode";
export const LOCAL_COLLECTION = "local";

export async function collectsLocally(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", COLLECTION_MODE_KEY)
    .maybeSingle();
  return data?.value === LOCAL_COLLECTION;
}

/**
 * Every account marked for local collection, in one read.
 *
 * Used by the loops that walk all customers — the scheduled crawl and the
 * weekly group refresh on the hosted side, and the worker on the local side —
 * so none of them asks once per customer.
 *
 * Requires a client that can read other users' settings, i.e. the service
 * role. Under RLS this returns only the caller's own row, which would quietly
 * make every other local account look cloud-collected.
 */
export async function usersCollectingLocally(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase
    .from("settings")
    .select("user_id")
    .eq("key", COLLECTION_MODE_KEY)
    .eq("value", LOCAL_COLLECTION);
  return new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
}
