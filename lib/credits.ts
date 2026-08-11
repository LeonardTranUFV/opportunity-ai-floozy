import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every balance change goes through the service role, never the caller's own
 * client.
 *
 * `adjust_credits` is SECURITY DEFINER and takes the target user id as an
 * argument, and Postgres grants EXECUTE to PUBLIC by default — so while the
 * RLS policy on user_credits correctly allows read-only access, the RPC itself
 * was callable straight from the browser with the public anon key. Anyone
 * could hand themselves an arbitrary balance, or drain someone else's, by
 * naming their user id. Verified against the live database: an anon-key call
 * reached the function body and failed only on a foreign key, which is
 * execution succeeding, not permission being refused.
 *
 * Routing the RPC through the service role here is what makes it safe to
 * revoke EXECUTE from anon and authenticated (migration 0008) without breaking
 * the app: the callers keep passing their own request-scoped client for reads,
 * and only this module's writes get the elevated one. The user id is always
 * one the caller already resolved from a verified session.
 */
function creditWriter(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

// 1 credit ~= $0.015 real AI cost (see FLOOZY_OPPORTUNITY_AI_BUSINESS_PLAN.md
// for the measured per-call costs this is based on). Only AI-driven actions
// cost credits — sending a comment/DM is free since that's the customer's
// own connected account, no AI call involved.
export const CREDIT_COSTS = {
  scanBatch: 2, // evaluating up to 100 posts in one Gemini call
  draftGeneration: 1, // generate or regenerate an outreach draft
  agentSetup: 1, // one-time AI-enhanced agent setup
  groupRecommendations: 1, // AI shortlist of which groups to go join
  // Live Facebook search: drives a real browser session rather than an API,
  // so it costs wall-clock time and carries the platform/ToS risk that the
  // cheap AI-only actions don't. Priced well above them to reflect that.
  discoverGroups: 5,
} as const;

export const PLAN_ALLOWANCES: Record<string, number> = {
  // 50, not the original 20. A trial account spends 1 on agent setup and 2 per
  // scan, so 20 was about eight scans before the app started refusing to work
  // — short enough that a tester could hit the wall during their first sitting
  // and read it as the product being broken. At ~$0.015 of real AI cost per
  // credit, the difference is under a dollar a head; running a test cohort out
  // of credits mid-evaluation costs far more than that in feedback.
  trial: 50,
  starter: 300,
  pro: 1000,
};

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Out of credits — upgrade your plan or wait for your next billing cycle.");
    this.name = "InsufficientCreditsError";
  }
}

// PostgREST error codes (NOT raw Postgres SQLSTATE codes — confirmed by
// checking the actual error shape live, since PostgREST wraps these
// differently) for "table not in schema cache" / "function not in schema
// cache" — thrown if supabase/migrations/0006_credits.sql hasn't been
// applied yet. Every credit check/spend below fails OPEN in that case
// (treats the action as allowed) rather than failing closed: a metering
// system that isn't set up yet must never be able to take down the app's
// core functionality (scanning, draft generation) for every user. The
// worst case of failing open is a few free actions before the migration
// runs; the worst case of failing closed is the whole product looking
// broken.
const MIGRATION_NOT_APPLIED_CODES = new Set(["PGRST205", "PGRST202"]);

function isMigrationNotAppliedError(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && MIGRATION_NOT_APPLIED_CODES.has(error.code);
}

/**
 * Spends credits for an AI-driven action. Throws InsufficientCreditsError if
 * the balance would go negative — callers should catch this specifically to
 * show a clear "out of credits" message rather than a generic error.
 *
 * Uses the adjust_credits() Postgres function (see
 * supabase/migrations/0006_credits.sql) so the balance check and the
 * deduction happen atomically in one transaction — a plain JS
 * read-balance-then-write-balance would race under concurrent requests
 * (e.g. two scans firing close together could both read "5 credits left,
 * this costs 2" and both proceed, leaving the balance negative).
 */
export async function spendCredits(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  metadata: Record<string, unknown> = {}
): Promise<number> {
  const { data, error } = await creditWriter().rpc("adjust_credits", {
    p_user_id: userId,
    p_amount: -Math.abs(amount),
    p_reason: reason,
    p_metadata: metadata,
  });

  if (error) {
    if (isMigrationNotAppliedError(error)) return -1; // credit system not active yet — nothing to record
    if (error.message?.includes("insufficient_credits")) {
      throw new InsufficientCreditsError();
    }
    throw new Error(error.message);
  }

  return data as number;
}

/** Grants credits (admin adjustment, monthly rollover top-up, purchased pack). */
export async function grantCredits(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  metadata: Record<string, unknown> = {}
): Promise<number> {
  const { data, error } = await creditWriter().rpc("adjust_credits", {
    p_user_id: userId,
    p_amount: Math.abs(amount),
    p_reason: reason,
    p_metadata: metadata,
  });

  if (error) throw new Error(error.message);
  return data as number;
}

/** Reason string for the one-time welcome grant, also used to detect it. */
const TRIAL_GRANT_REASON = "trial_grant";

/**
 * Gives a new account its trial credits the first time it's seen.
 *
 * Nothing used to do this. `user_credits` defaults `balance` to 0, no trigger
 * on auth.users seeded it, and `grantCredits` was never called from any signup
 * path — so every account started on zero and the first AI action it attempted
 * came back "Out of credits — upgrade your plan or wait for your next billing
 * cycle." A brand-new customer's read of that is that the product is a paywall
 * with nothing behind it. Confirmed against the live database rather than
 * inferred: of four accounts, three had no credit row at all and the fourth
 * held a balance of 1, against a scan that costs 2.
 *
 * Idempotent by looking for the grant's own transaction rather than by
 * checking the balance, which would re-grant to anyone who had spent down to
 * zero — turning a welcome bonus into an unlimited refill.
 *
 * Returns true when it granted, so a caller can tell a first visit from a
 * returning one. Never throws: failing to top up a new account must not be
 * able to block the page it was called from.
 */
export async function ensureTrialCredits(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { data: priorGrant, error: lookupError } = await supabase
      .from("credit_transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("reason", TRIAL_GRANT_REASON)
      .limit(1)
      .maybeSingle();

    // Credit tables not migrated yet: the whole system is inactive and
    // spendCredits already fails open, so there is nothing to grant against.
    if (lookupError && isMigrationNotAppliedError(lookupError)) return false;
    if (lookupError) return false;
    if (priorGrant) return false;

    await grantCredits(supabase, userId, PLAN_ALLOWANCES.trial, TRIAL_GRANT_REASON, {
      note: "Welcome — trial credits",
    });
    return true;
  } catch {
    return false;
  }
}

export async function getCreditBalance(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await supabase.from("user_credits").select("balance").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMigrationNotAppliedError(error)) return Number.POSITIVE_INFINITY;
    throw new Error(error.message);
  }
  return data?.balance ?? 0;
}

export async function hasCredits(supabase: SupabaseClient, userId: string, amount: number): Promise<boolean> {
  const balance = await getCreditBalance(supabase, userId);
  return balance >= amount;
}
