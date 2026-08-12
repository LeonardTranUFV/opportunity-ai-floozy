import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Consent records.
 *
 * What makes a consent defensible is not the checkbox — it is being able to
 * say *which* wording someone agreed to and *when*. So both are stored, and
 * `TERMS_VERSION` must be bumped in step with the LAST_UPDATED date on
 * /terms and /privacy. If the wording changes and this does not, the record
 * points at terms nobody can reconstruct.
 *
 * Stored in `settings`, the app's generic per-user key/value table, so this
 * needs no migration. Keys:
 *
 *   terms_version_accepted  the TERMS_VERSION string they accepted
 *   terms_accepted_at       ISO timestamp
 *   pool_opt_in             'true' | 'false' — separate, revocable, optional
 *   pool_consent_version    the TERMS_VERSION current when they opted in
 */
export const TERMS_VERSION = "2026-08-11";

export type ConsentState = {
  termsVersion: string | null;
  acceptedAt: string | null;
  poolOptIn: boolean;
  /** True when they have accepted the *current* terms, not merely some terms. */
  current: boolean;
};

export async function getConsent(
  supabase: SupabaseClient,
  userId: string
): Promise<ConsentState> {
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", ["terms_version_accepted", "terms_accepted_at", "pool_opt_in"]);

  const map = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));
  const termsVersion = map.get("terms_version_accepted") ?? null;

  return {
    termsVersion,
    acceptedAt: map.get("terms_accepted_at") ?? null,
    poolOptIn: map.get("pool_opt_in") === "true",
    current: termsVersion === TERMS_VERSION,
  };
}

/**
 * Records acceptance. `poolOptIn` is passed separately from the terms
 * acceptance on purpose: agreeing to the terms is required to use the service,
 * contributing to the pool is not, and bundling them into one checkbox is the
 * thing that makes a consent worthless.
 */
export async function recordConsent(
  supabase: SupabaseClient,
  userId: string,
  poolOptIn: boolean
): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const rows = [
    { user_id: userId, key: "terms_version_accepted", value: TERMS_VERSION, updated_at: now },
    { user_id: userId, key: "terms_accepted_at", value: now, updated_at: now },
    { user_id: userId, key: "pool_opt_in", value: poolOptIn ? "true" : "false", updated_at: now },
    { user_id: userId, key: "pool_consent_version", value: TERMS_VERSION, updated_at: now },
  ];

  const { error } = await supabase.from("settings").upsert(rows, { onConflict: "user_id,key" });
  return { error: error?.message ?? null };
}

/** Flips only the pool setting — used by the Settings toggle, not signup. */
export async function setPoolOptIn(
  supabase: SupabaseClient,
  userId: string,
  optIn: boolean
): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const { error } = await supabase.from("settings").upsert(
    [
      { user_id: userId, key: "pool_opt_in", value: optIn ? "true" : "false", updated_at: now },
      { user_id: userId, key: "pool_consent_version", value: TERMS_VERSION, updated_at: now },
    ],
    { onConflict: "user_id,key" }
  );
  return { error: error?.message ?? null };
}
