import type { SupabaseClient } from "@supabase/supabase-js";

// 1 credit ~= $0.015 real AI cost (see FLOOZY_OPPORTUNITY_AI_BUSINESS_PLAN.md
// for the measured per-call costs this is based on). Only AI-driven actions
// cost credits — sending a comment/DM is free since that's the customer's
// own connected account, no AI call involved.
export const CREDIT_COSTS = {
  scanBatch: 2, // evaluating up to 100 posts in one Gemini call
  draftGeneration: 1, // generate or regenerate an outreach draft
  agentSetup: 1, // one-time AI-enhanced agent setup
  groupRecommendations: 1, // AI shortlist of which groups to go join
} as const;

export const PLAN_ALLOWANCES: Record<string, number> = {
  trial: 20,
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
  const { data, error } = await supabase.rpc("adjust_credits", {
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
  const { data, error } = await supabase.rpc("adjust_credits", {
    p_user_id: userId,
    p_amount: Math.abs(amount),
    p_reason: reason,
    p_metadata: metadata,
  });

  if (error) throw new Error(error.message);
  return data as number;
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
