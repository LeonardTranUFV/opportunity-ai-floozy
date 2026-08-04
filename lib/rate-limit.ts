import { NextResponse } from "next/server";

/**
 * Fixed-window rate limiter for API routes.
 *
 * SCOPE — read this before trusting it: state lives in this process's memory,
 * so on Vercel each serverless instance counts separately. At private-beta
 * traffic that's effectively one instance and the limits hold; under real load
 * an attacker could get N x the limit by hitting N instances. It is a real
 * brake on runaway cost and casual abuse, NOT a hard security boundary.
 *
 * The durable fix is a shared store (Postgres table or Upstash Redis). That is
 * deliberately not done here: a Postgres-backed limiter needs a migration, and
 * migrations in this project must be pasted into the SQL editor by hand —
 * shipping an unapplied one is the exact fail-open trap this codebase already
 * hit once with credits. Upgrade when traffic justifies it.
 *
 * Auth (login/signup/reset) is NOT limited here — those never touch our API,
 * they go straight from the browser to Supabase, which enforces its own limits
 * server-side. Configure those in Supabase → Auth → Rate Limits.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Stop the map growing without bound on a long-lived instance.
const CLEANUP_EVERY_MS = 5 * 60_000;
let lastCleanup = Date.now();

function sweep(now: number) {
  if (now - lastCleanup < CLEANUP_EVERY_MS) return;
  lastCleanup = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * @param key    Caller identity — prefer a user id over an IP, since IPs are
 *               shared behind NAT and spoofable via headers.
 * @param limit  Requests allowed per window.
 * @param windowMs Window length.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** Standard 429 with Retry-After so clients can back off properly. */
export function tooManyRequests(result: RateLimitResult, what = "requests") {
  const mins = Math.ceil(result.retryAfterSeconds / 60);
  return NextResponse.json(
    {
      error: `Too many ${what}. Try again in ${mins === 1 ? "a minute" : `${mins} minutes`}.`,
    },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}

/** Presets, tuned to what each action actually costs us. */
export const LIMITS = {
  /** Real money per call (Gemini) — keep tight. */
  ai: { limit: 10, windowMs: 15 * 60_000 },
  /** Drives a real browser session; slow and carries platform risk. */
  browser: { limit: 5, windowMs: 15 * 60_000 },
  /** Ordinary reads/writes — generous, just stops runaway loops. */
  standard: { limit: 60, windowMs: 60_000 },
  /** Unauthenticated or abuse-prone surfaces. */
  strict: { limit: 5, windowMs: 15 * 60_000 },
} as const;
