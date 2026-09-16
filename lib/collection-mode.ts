import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionPlatform } from "@/lib/session-platform";

/**
 * Which accounts — and which of their platforms — are crawled from the
 * operator's PC instead of the cloud.
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
 * then refuses to open a browser for it. With the flag set, every request to a
 * local platform leaves from the worker's machine or it does not happen.
 * Clients stay on the cloud path by default and nothing about them changes.
 *
 * ── Per platform, not per account ───────────────────────────────────────────
 *
 * This started as one switch for the whole account, and that was wrong within
 * a day. The operator runs the worker from Vietnam, where nextdoor.com
 * resolves to 0.0.0.0 at the ISP — so marking the account local stopped the
 * cloud reading Nextdoor, the PC could not reach it, and the best-converting
 * source in the account was collected nowhere. Nextdoor had never drawn a
 * warning; only Facebook needed moving.
 *
 *   "local"                  every platform is collected on the PC
 *   "local:facebook"         only these; everything else stays on the cloud
 *   "local:facebook,twitter"
 *
 * Platforms are compared through sessionPlatform, so marking Facebook local
 * carries Marketplace with it — they share one login, and splitting them would
 * put one session on two IPs.
 *
 * Stored as a `settings` row rather than a column, for the reason
 * GROUPS_REFRESHED_AT_KEY gives: migrations here are applied by hand, and a new
 * column means the check silently fails until somebody runs the SQL. It is not
 * on the settings route's WRITABLE_KEYS, so a customer cannot set it through
 * the app; it is an operator decision made with the service role.
 */
export const COLLECTION_MODE_KEY = "collection_mode";
export const LOCAL_COLLECTION = "local";

/** Every platform local, or just the named ones. */
export type LocalPlatforms = "all" | Set<string>;

export function parseCollectionMode(value: unknown): LocalPlatforms | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === LOCAL_COLLECTION) return "all";
  if (!v.startsWith(`${LOCAL_COLLECTION}:`)) return null;
  const named = new Set(
    v
      .slice(LOCAL_COLLECTION.length + 1)
      .split(",")
      .map((p) => sessionPlatform(p.trim()))
      .filter(Boolean)
  );
  // "local:" with nothing after it names no platform, so it moves nothing —
  // read as cloud rather than as "all", which would be the surprising answer.
  return named.size ? named : null;
}

/** Whether this platform, for an account in this mode, is the PC's to crawl. */
export function isCollectedLocally(mode: LocalPlatforms | null | undefined, platform: string): boolean {
  if (!mode) return false;
  return mode === "all" || mode.has(sessionPlatform(platform));
}

export async function localPlatformsFor(supabase: SupabaseClient, userId: string): Promise<LocalPlatforms | null> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", COLLECTION_MODE_KEY)
    .maybeSingle();
  return parseCollectionMode(data?.value);
}

/**
 * Whether an account collects locally — for one platform when given, or for
 * any platform at all when not.
 */
export async function collectsLocally(supabase: SupabaseClient, userId: string, platform?: string): Promise<boolean> {
  const mode = await localPlatformsFor(supabase, userId);
  return platform === undefined ? mode !== null : isCollectedLocally(mode, platform);
}

/**
 * Every account with at least one local platform, and which, in one read.
 *
 * Used by the loops that walk all customers — the scheduled crawl and the
 * weekly group refresh on the hosted side, and the worker on the local side —
 * so none of them asks once per customer.
 *
 * Requires a client that can read other users' settings, i.e. the service
 * role. Under RLS this returns only the caller's own row, which would quietly
 * make every other local account look cloud-collected.
 */
export async function localCollectionModes(supabase: SupabaseClient): Promise<Map<string, LocalPlatforms>> {
  const { data } = await supabase
    .from("settings")
    .select("user_id, value")
    .eq("key", COLLECTION_MODE_KEY)
    .like("value", `${LOCAL_COLLECTION}%`);
  const modes = new Map<string, LocalPlatforms>();
  for (const row of (data ?? []) as { user_id: string; value: string }[]) {
    const mode = parseCollectionMode(row.value);
    if (mode) modes.set(row.user_id, mode);
  }
  return modes;
}

export async function usersCollectingLocally(supabase: SupabaseClient): Promise<Set<string>> {
  return new Set((await localCollectionModes(supabase)).keys());
}
