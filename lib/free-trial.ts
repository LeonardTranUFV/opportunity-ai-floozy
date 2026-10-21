import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The no-card free trial: seven days of the full product from the moment an
 * account is first seen, with a card optional the whole time.
 *
 * ── Where the clock starts ─────────────────────────────────────────────────
 *
 * At the welcome grant — the `trial_grant` credit transaction that
 * ensureTrialCredits writes on an account's first authenticated page load.
 * That row already exists for every account, is written exactly once, and
 * carries its own created_at, so the trial needs no new column and no
 * migration. An account with no grant yet has not started its trial.
 *
 * ── Accounts that predate the trial ────────────────────────────────────────
 *
 * Free accounts used to be open-ended (50 credits, no clock). Starting their
 * seven days from their own sign-up date would end the trial for all of them
 * the moment this shipped, so their clock starts at the launch date instead.
 *
 * ── Failure mode ───────────────────────────────────────────────────────────
 *
 * Fails open (trial not ended) on any error, matching lib/entitlement.ts: a
 * billing lookup that breaks must never lock someone out of the product.
 */

export const FREE_TRIAL_DAYS = 7;

/** Accounts created before this get their seven days counted from here. */
const FREE_TRIAL_LAUNCH = new Date("2026-10-01T00:00:00Z");

/** Reason string of the one-time welcome grant; written by lib/credits.ts. */
export const TRIAL_GRANT_REASON = "trial_grant";

/** Reason string of a bought credit pack; written by the Stripe webhook. */
const PACK_PURCHASE_REASON = "top_up_purchase";

const DAY_MS = 86_400_000;

export interface FreeTrial {
  /** When the trial ends. Null when it has not started yet. */
  endsAt: Date | null;
  /** Whole days left, never negative. Null when it has not started yet. */
  daysLeft: number | null;
  ended: boolean;
}

const NOT_STARTED: FreeTrial = { endsAt: null, daysLeft: null, ended: false };

export async function getFreeTrial(supabase: SupabaseClient, userId: string): Promise<FreeTrial> {
  try {
    const { data, error } = await supabase
      .from("credit_transactions")
      .select("created_at")
      .eq("user_id", userId)
      .eq("reason", TRIAL_GRANT_REASON)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data?.created_at) return NOT_STARTED;

    const granted = new Date(data.created_at as string);
    if (Number.isNaN(granted.getTime())) return NOT_STARTED;

    const start = granted < FREE_TRIAL_LAUNCH ? FREE_TRIAL_LAUNCH : granted;
    const endsAt = new Date(start.getTime() + FREE_TRIAL_DAYS * DAY_MS);
    const msLeft = endsAt.getTime() - Date.now();
    return {
      endsAt,
      daysLeft: Math.max(0, Math.ceil(msLeft / DAY_MS)),
      ended: msLeft <= 0,
    };
  } catch {
    return NOT_STARTED;
  }
}

/**
 * True when someone has bought a credit pack. Packs are sold to free accounts
 * as a way to keep going, so credits somebody paid for stay spendable after
 * the trial ends.
 */
export async function hasBoughtCredits(supabase: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("credit_transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("reason", PACK_PURCHASE_REASON)
      .limit(1)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}
