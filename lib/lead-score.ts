/**
 * Turns the scoring model's four 1–5 ratings into the 0–100 intent_score and
 * the urgency label the rest of the app already uses.
 *
 * Why the model no longer picks the number itself: asked for "0-100, how
 * strongly this matches", the model answered in a narrow, inflated band —
 * on a 45-lead sample from production (2026-10-12) every score was a multiple
 * of 5, two thirds sat between 75 and 95, and a one-line "any local plumbers
 * know macerator toilets?" got 95 while "does anyone have spare logs for
 * seating?" got 85. The same post also scored differently for two agents with
 * the same goal. A number nobody can explain can't be tuned, and the two lines
 * that matter downstream — 60 for the morning email (lib/lead-digest.ts) and
 * 90 for the HOT badge — were being crossed more or less at random.
 *
 * So the model now answers four narrow questions against written anchors
 * (lib/ai.ts, "How to rate"), and this file does the arithmetic. The weights
 * are integers summing to 100 so the total is an exact integer before the one
 * rounding step; nothing here touches floating point until the final divide.
 */

export interface LeadRatings {
  /** Is the author asking for work to be done for them? 5 = explicit ask, 1 = no ask. */
  need: number;
  /** Is the job the agent's own trade or goal? 5 = squarely, 1 = clearly a different trade. */
  fit: number;
  /** How soon? 5 = emergency now, 4 = days, 3 = normal ask, 2 = someday, 1 = no timing. */
  urgency: number;
  /** Enough to act on? 5 = scope + place/size, 3 = scope only, 1 = one vague line. */
  detail: number;
}

export type UrgencyLabel = "low" | "medium" | "high" | "asap";

export interface LeadScore {
  relevant: boolean;
  intent_score: number;
  urgency: UrgencyLabel;
}

export const LEAD_WEIGHTS = { need: 35, fit: 30, urgency: 20, detail: 15 } as const;

/**
 * Below the morning-email line (MIN_SCORE 60). A real need in the wrong trade,
 * or a faint ask, is still shown in the app for whoever wants to browse — but it
 * should never land in a contractor's inbox as a lead.
 */
export const WEAK_CAP = 55;

function clampRating(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, n));
}

export function urgencyLabel(rating: number): UrgencyLabel {
  if (rating >= 5) return "asap";
  if (rating === 4) return "high";
  if (rating === 3) return "medium";
  return "low";
}

/**
 * relevant: the model's direction call (customer vs. ad/competitor/hiring),
 * which stays a model judgment — it is the part that needs reading comprehension.
 * Two hard gates sit on top of it, because a post the model itself rated 1 for
 * need or fit cannot be a lead whatever it said about direction.
 */
export function scoreLead(modelSaysRelevant: boolean, raw: Partial<LeadRatings>): LeadScore {
  const r: LeadRatings = {
    need: clampRating(raw.need),
    fit: clampRating(raw.fit),
    urgency: clampRating(raw.urgency),
    detail: clampRating(raw.detail),
  };
  const relevant = modelSaysRelevant && r.need > 1 && r.fit > 1;
  if (!relevant) return { relevant: false, intent_score: 0, urgency: urgencyLabel(r.urgency) };

  // 100–500, an exact integer. ×20/100 maps a straight-1 post to 20 and a
  // straight-5 post to 100, i.e. score = weighted mean × 20.
  const weighted =
    r.need * LEAD_WEIGHTS.need +
    r.fit * LEAD_WEIGHTS.fit +
    r.urgency * LEAD_WEIGHTS.urgency +
    r.detail * LEAD_WEIGHTS.detail;
  // weighted / 5, rounded half up, in integer arithmetic: 452 → 90, 453 → 91.
  let score = Math.floor((weighted * 2 + 5) / 10);

  if (r.need <= 2 || r.fit <= 2) score = Math.min(score, WEAK_CAP);

  return { relevant: true, intent_score: score, urgency: urgencyLabel(r.urgency) };
}
