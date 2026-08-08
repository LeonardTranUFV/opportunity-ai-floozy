import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limiter, backed by Postgres and shared across instances.
 *
 * ── What changed, and why it mattered ──────────────────────────────────────
 *
 * This used to keep counts in a `Map` in process memory. On Vercel each
 * serverless instance had its own, so a caller hitting N instances got N times
 * the limit, and every deploy reset every counter to zero. `SECURITY.md` called
 * it what it was: a brake on runaway cost, not a boundary.
 *
 * State now lives in the `rate_limits` table, so every instance counts against
 * the same total. The increment happens inside `bump_rate_limit()` as a single
 * `insert … on conflict do update`, because read-then-write from here would
 * race between concurrent invocations and let a burst through — which is the
 * exact hole this was meant to close.
 *
 * ── The unapplied-migration trap, handled ──────────────────────────────────
 *
 * Migrations in this project are pasted into the SQL editor by hand, so there
 * is always a window where the code is deployed and the table is not there yet.
 * Failing open in that window would mean *no* limiting at all, silently — the
 * trap this codebase already hit once with credits.
 *
 * So a database failure falls back to the in-memory limiter instead. The worst
 * case is therefore exactly the old behaviour, never worse, and it says so in
 * the logs. The probe repeats every minute, so the moment the migration is
 * applied this upgrades itself with no redeploy.
 *
 * ── Not covered here ───────────────────────────────────────────────────────
 *
 * Auth (login / signup / reset) never touches our API — the browser talks
 * straight to Supabase, which enforces its own limits. Configure those under
 * Supabase → Auth → Rate Limits.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  /** True when the shared store was unreachable and this fell back to memory. */
  degraded: boolean;
}

// ── In-memory fallback ──────────────────────────────────────────────────────
//
// Kept deliberately. It is what runs before the migration is applied, and what
// runs if the database is briefly unreachable. Same fixed-window semantics as
// the shared path so behaviour does not change shape when it degrades.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const CLEANUP_EVERY_MS = 5 * 60_000;
let lastCleanup = Date.now();

function sweepMemory(now: number) {
  if (now - lastCleanup < CLEANUP_EVERY_MS) return;
  lastCleanup = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

function memoryLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweepMemory(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0, degraded: true };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      degraded: true,
    };
  }
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds: 0,
    degraded: true,
  };
}

// ── Shared store ────────────────────────────────────────────────────────────

/**
 * When the shared store last failed. Re-probed after this cools off, so
 * applying the migration takes effect on its own rather than needing a deploy.
 */
let sharedStoreDownUntil = 0;
const REPROBE_AFTER_MS = 60_000;

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();

  if (now < sharedStoreDownUntil) return memoryLimit(key, limit, windowMs);

  // Fixed window: everything in the same slice of time shares a row. Derived
  // rather than stored so every instance computes the same boundary without
  // coordinating.
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const resetAtMs = windowStartMs + windowMs;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("bump_rate_limit", {
      p_key: key,
      p_window_start: new Date(windowStartMs).toISOString(),
    });

    if (error) throw error;

    const count = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(count)) throw new Error(`bump_rate_limit returned ${String(data)}`);

    if (count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
        degraded: false,
      };
    }
    return { allowed: true, remaining: limit - count, retryAfterSeconds: 0, degraded: false };
  } catch (err) {
    sharedStoreDownUntil = now + REPROBE_AFTER_MS;
    // Loud on purpose. Silently degrading to per-process counting is how a
    // limit quietly stops being one.
    console.error(
      "[rate-limit] shared store unavailable, falling back to per-process counting. " +
        "If this persists, migration 0007_rate_limits.sql has not been applied.",
      err instanceof Error ? err.message : err
    );
    return memoryLimit(key, limit, windowMs);
  }
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
