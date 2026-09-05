import { PLAN_ALLOWANCES } from "@/lib/credits";

/**
 * Credit packs: one-off top-ups bought on the plan page.
 *
 * ── PLACEHOLDER PRICES — Leo to confirm ────────────────────────────────────
 *
 * Nobody has set a pack price yet, so these are a first proposal, chosen so a
 * pack is always a little dearer per credit than the plan that includes them
 * (the plan is the commitment; the pack is the convenience):
 *
 *   monthly  $149 / 1000 credits ≈ 14.9¢  → pack 18¢
 *   weekly    $49 /  300 credits ≈ 16.3¢  → pack 20¢
 *   trial     nothing paid yet            → pack 25¢
 *
 * Change a number here and every quote, button and Stripe line item follows.
 * Nothing else in the codebase knows a pack price.
 */
export const PACK_CENTS_PER_CREDIT: Record<string, number> = {
  trial: 25,
  weekly: 20,
  monthly: 18,
};

/** The quantities offered. Bounded so a typo can't buy 100,000 credits. */
export const PACK_SIZES = [100, 250, 500, 1000, 2000] as const;
export type PackSize = (typeof PACK_SIZES)[number];

export const PACK_CURRENCY = "cad";

export function isPackSize(n: unknown): n is PackSize {
  return typeof n === "number" && (PACK_SIZES as readonly number[]).includes(n);
}

export function packRateFor(plan: string | null | undefined): number {
  return PACK_CENTS_PER_CREDIT[plan ?? "trial"] ?? PACK_CENTS_PER_CREDIT.trial;
}

export interface PackQuote {
  credits: number;
  centsPerCredit: number;
  totalCents: number;
}

export function packQuote(plan: string | null | undefined, credits: number): PackQuote {
  const centsPerCredit = packRateFor(plan);
  return { credits, centsPerCredit, totalCents: credits * centsPerCredit };
}

/** "$18.00" style, CAD, from cents. */
export function formatCad(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

/**
 * What a plan works out to per credit, for the comparison table. The plan
 * prices live on the pricing page and the Stripe links; repeated here only as
 * display figures, and they must match app/pricing/page.tsx.
 */
export const PLAN_PRICE_CENTS: Record<string, number> = {
  weekly: 4900,
  monthly: 14900,
};

export function planCentsPerCredit(plan: string): number | null {
  const price = PLAN_PRICE_CENTS[plan];
  const allowance = PLAN_ALLOWANCES[plan];
  if (!price || !allowance) return null;
  return price / allowance;
}

/** True when a Stripe secret key is configured, i.e. packs can be sold. */
export function packsEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
