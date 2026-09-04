import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionPlatform } from "@/lib/scraper";

/**
 * What a customer's subscription entitles them to.
 *
 * `subscriptions` has been written by the Stripe webhook since it was added and
 * read by nothing — so paying changed the row and nothing else. This is the
 * first thing that reads it.
 */

/**
 * Stripe statuses that mean "serve this customer".
 *
 * past_due is deliberately included. It means a renewal payment failed and
 * Stripe is retrying, which is usually an expired card — cutting service off
 * at the first failed charge punishes the customer for their bank's timing.
 * Stripe moves the subscription to `canceled` or `unpaid` when it gives up,
 * and those are not on this list.
 */
const ENTITLED_STATUSES = new Set(["trialing", "active", "past_due"]);

/** Nobody paying: either never subscribed, or the subscription has ended. */
export const FREE_PLAN = "trial";

/**
 * How many sources needing a signed-in browser a plan may monitor at once.
 *
 * ── Why this limit exists at all ───────────────────────────────────────────
 *
 * Not to create upgrade pressure, though it can carry that later. Scheduled
 * collection shares one fixed budget across every customer (see
 * app/api/cron/collect/route.ts), so sources are the unit of a shared,
 * genuinely finite resource. Without a cap, one account monitoring two hundred
 * groups quietly consumes the crawl time every other customer is waiting on,
 * and the only visible symptom is everybody else's leads going stale.
 *
 * ── Why Reddit does not count ──────────────────────────────────────────────
 *
 * The scarce thing is browser minutes, and Reddit is read over plain HTTP with
 * no browser and no session. Counting it would ration something that costs
 * nothing.
 *
 * ── Why every plan is the same number today ────────────────────────────────
 *
 * Because there is only one product. Weekly and monthly are the same thing
 * billed differently, not two tiers, so a per-plan number would be inventing a
 * distinction the pricing page does not sell. The map is keyed by plan so that
 * a real tier is one line here rather than a refactor.
 */
export const ACTIVE_SOURCE_LIMITS: Record<string, number> = {
  trial: 10,
  weekly: 10,
  monthly: 10,
};

const DEFAULT_ACTIVE_SOURCE_LIMIT = 10;

export function activeSourceLimitFor(plan: string): number {
  return ACTIVE_SOURCE_LIMITS[plan] ?? DEFAULT_ACTIVE_SOURCE_LIMIT;
}

/**
 * True when this source needs a signed-in browser, and therefore counts.
 *
 * Routed through sessionPlatform rather than compared to "facebook" directly:
 * Marketplace rides inside the Facebook session, so it is one more page read
 * through that customer's own login and belongs on the same budget.
 */
export function countsTowardSourceLimit(platform: string): boolean {
  return sessionPlatform(platform) !== "reddit";
}

/**
 * Which plan this customer is on right now.
 *
 * Fails open to the free plan on any error, including the table not existing
 * yet. Every plan currently allows the same number of sources, so an outage in
 * billing cannot lock anybody out of their own product — and if tiers ever
 * diverge, the failure mode to keep is under-charging, never refusing service
 * to somebody who has paid.
 */
export async function getPlan(supabase: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", userId)
      .maybeSingle();

    if (!data || !ENTITLED_STATUSES.has(data.status as string)) return FREE_PLAN;
    return (data.plan as string | null) ?? FREE_PLAN;
  } catch {
    return FREE_PLAN;
  }
}

export interface SourceCapacity {
  plan: string;
  /** Active sources that need a browser. */
  used: number;
  limit: number;
  remaining: number;
}

/** What the customer is using, and what they are allowed. */
export async function getSourceCapacity(
  supabase: SupabaseClient,
  userId: string
): Promise<SourceCapacity> {
  const plan = await getPlan(supabase, userId);
  const limit = activeSourceLimitFor(plan);

  const { data } = await supabase
    .from("groups")
    .select("platform")
    .eq("user_id", userId)
    .eq("active", true);

  const used = (data ?? []).filter((g) => countsTowardSourceLimit(g.platform as string)).length;

  return { plan, used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * The message shown when someone tries to switch on one source too many.
 *
 * Says the number, and says what to do about it. "Limit reached" on its own
 * leaves a customer to guess whether they should delete something, pay, or
 * wait — and pausing is the answer most of them want, because a paused source
 * keeps everything it has already collected.
 */
export function sourceLimitMessage(capacity: SourceCapacity): string {
  return `You're monitoring ${capacity.used} of ${capacity.limit} sources. Pause one to switch another on — paused sources keep the posts they've already collected. Reddit sources don't count toward this.`;
}
