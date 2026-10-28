/**
 * The skeptic: a second, cheap AI pass that tries to reject each lead the
 * scorer let through, and the per-lead proof shown beside it.
 *
 * Why a second pass at all: the scorer (lib/ai.ts → lib/lead-score.ts) is
 * asked "how good is this lead?", and a model asked that question leans
 * towards yes. A separate call whose only job is to find the reason a lead is
 * *not* a lead catches a different set of mistakes — the business advertising
 * in the voice of a customer, the ask from last spring, the "update: found
 * someone, thanks". The idea comes from a competitor's lead-finding skill
 * tested on 2026-10-28 (12 searchers plus one skeptic); its rules worth
 * copying were the skeptic, a source link and date beside every lead, and a
 * High/Medium/Low label.
 *
 * Everything in this file is plain logic so `npm run check` can pin it down.
 * The model call itself is `skepticCheckLeads` in lib/ai.ts.
 *
 * It fails open on purpose. A lead the skeptic could not check, or rejected
 * without naming one of the reasons below, is kept. The rest of the pipeline
 * is built on "a dropped customer costs more than a weak lead" (see the v2.1
 * note in lib/ai.ts), and a second model that can quietly delete leads is the
 * easiest way to break that.
 */

import { MIN_SCORE } from "@/lib/lead-score";

/**
 * SKEPTIC_MODE, read from the environment so it can be changed without a
 * deploy:
 *
 *   off     (default) no skeptic call, no new columns read or written — the app
 *           behaves exactly as before, and works without migration 0020.
 *   shadow  every new lead at MIN_SCORE+ is checked and the verdict stored and
 *           shown in the app, but nothing is held back from the morning email.
 *           This is the measuring mode: run it for a week, then compare.
 *   on      as shadow, and rejected leads are left out of the morning email.
 *           They stay in the app with the reason.
 *
 * Anything else reads as off, so a typo can never switch filtering on.
 * shadow and on both need migration 0020 applied first.
 */
export type SkepticMode = "off" | "shadow" | "on";

export function skepticMode(value: string | undefined = process.env.SKEPTIC_MODE): SkepticMode {
  const v = (value ?? "").trim().toLowerCase();
  return v === "shadow" || v === "on" ? v : "off";
}

/** Bump with a line in lib/ai.ts whenever the skeptic prompt changes. */
export const SKEPTIC_PROMPT_VERSION = "s1";

/**
 * The only grounds for a rejection. A model that says "reject" without one of
 * these is overruled — "feels weak" is the scorer's job, not the skeptic's.
 */
export const SKEPTIC_REASONS = {
  no_ask: "No buyer intent — nobody is asking for the work",
  advertising: "A business advertising, not a customer asking",
  too_old: "Too old — the post itself says the moment has passed",
  outside_area: "Outside the service area",
  already_hired: "Already hired someone or solved it",
} as const;

export type SkepticCode = keyof typeof SKEPTIC_REASONS;

export interface SkepticVerdict {
  verdict: "keep" | "reject";
  /** Set only on a reject. */
  code: SkepticCode | null;
  /** One line, shown on the card. */
  reason: string;
}

/** Which leads are worth a skeptic call: only ones that could reach the email. */
export function needsSkeptic(intentScore: number | null | undefined): boolean {
  return (intentScore ?? 0) >= MIN_SCORE;
}

const MAX_REASON_CHARS = 160;

function oneLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_REASON_CHARS);
}

/**
 * The model's answer, checked line by line, one slot per lead sent.
 *
 * A slot is null when the model gave nothing usable for that lead — the caller
 * leaves it unchecked, which counts as kept. Matched by the echoed 1-based
 * index (same scheme as post scoring in scan-agent.ts), falling back to
 * position, and a second answer for the same slot is ignored rather than
 * trusted.
 */
export function parseSkepticResponse(raw: unknown, count: number): (SkepticVerdict | null)[] {
  const out: (SkepticVerdict | null)[] = Array.from({ length: count }, () => null);
  if (!Array.isArray(raw)) return out;
  const claimed = new Set<number>();

  raw.forEach((item, position) => {
    if (!item || typeof item !== "object") return;
    const v = item as Record<string, unknown>;
    const echoed = Number.isInteger(v.index) ? (v.index as number) - 1 : NaN;
    const slot = !Number.isNaN(echoed) && echoed >= 0 && echoed < count ? echoed : position;
    if (slot >= count || claimed.has(slot)) return;
    claimed.add(slot);

    const reason = oneLine(v.reason);
    const code = typeof v.code === "string" && v.code in SKEPTIC_REASONS ? (v.code as SkepticCode) : null;

    if (v.verdict === "reject" && code) {
      out[slot] = { verdict: "reject", code, reason: reason || SKEPTIC_REASONS[code] };
    } else if (v.verdict === "keep" || v.verdict === "reject") {
      // A reject with no listed reason is overruled to keep, and says so, so a
      // reviewer can see the model wanted to drop it.
      out[slot] = {
        verdict: "keep",
        code: null,
        reason: v.verdict === "reject" ? `Kept: rejected without a listed reason (${reason || "none given"})` : reason,
      };
    }
  });
  return out;
}

/** The columns a verdict is stored in (migration 0020). */
export function skepticColumns(v: SkepticVerdict | null, at = new Date()) {
  if (!v) return {};
  return {
    skeptic_verdict: v.verdict,
    skeptic_code: v.code,
    skeptic_reason: v.reason,
    skeptic_version: SKEPTIC_PROMPT_VERSION,
    skeptic_checked_at: at.toISOString(),
  };
}

export type Confidence = "High" | "Medium" | "Low";

/**
 * High / Medium / Low, from facts a contractor can check for themselves.
 *
 *   Low     the skeptic rejected it, or it scored under the email line
 *   High    scored 80+, a direct link to the post itself, the post's own date
 *           known, and not rejected — everything a contractor needs to check it
 *   Medium  everything else — most often a good lead with no post date or only
 *           a group link, which is a lot of Facebook. Missing proof stops a lead
 *           being High; it does not make a real ask Low.
 *
 * Deliberately not the model's own "how sure are you": that number is the one
 * lib/lead-score.ts stopped trusting.
 */
export const HIGH_CONFIDENCE_SCORE = 80;

/**
 * The post's own date, or null. A string has to start like an ISO date: V8
 * happily parses "15 May" as 15 May 2001, and "Posted 2001" or a High label on
 * the strength of it would be worse than saying the date is unknown.
 */
export function knownPostDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function leadConfidence(input: {
  score: number;
  postedAt: Date | string | null;
  hasExactLink: boolean;
  skepticVerdict?: string | null;
}): Confidence {
  if (input.skepticVerdict === "reject") return "Low";
  if (input.score < MIN_SCORE) return "Low";
  if (input.score >= HIGH_CONFIDENCE_SCORE && input.hasExactLink && knownPostDate(input.postedAt)) return "High";
  return "Medium";
}

/** Does this lead go in the morning email under this mode? */
export function skepticAllowsEmail(skepticVerdict: string | null | undefined, mode: SkepticMode): boolean {
  return mode !== "on" || skepticVerdict !== "reject";
}
