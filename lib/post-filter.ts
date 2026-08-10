import type { AgentProfile } from "@/lib/ai";

/**
 * Zero-cost local gate that runs before any post reaches Gemini.
 *
 * The scan pipeline charges credits and burns free-tier request quota per
 * *batch* of 100 posts, so dropping obvious non-opportunities locally doesn't
 * just shrink each prompt — it collapses batch count. 250 posts filtered down
 * to 180 is 3 Gemini requests instead of 3; filtered to 95 it's 1 instead of 3,
 * which is 4 credits and 13 seconds of inter-batch pacing saved.
 *
 * The asymmetry that shapes every rule here: wrongly dropping a real lead is
 * invisible and costs the customer a job, while wrongly keeping junk costs a
 * fraction of a cent. So this only rejects posts that cannot be an opportunity
 * under any reading — never anything that needs judgment. Judgment is what
 * Gemini is for.
 */

export interface FilterablePost {
  id: string;
  raw_text: string;
}

export type RejectReason = "too_short" | "no_prose" | "negative_keyword" | "duplicate_text";

export interface FilterResult<T> {
  /** Posts that still need AI judgment. */
  kept: T[];
  /**
   * Posts rejected locally. These must still be recorded as evaluated so they
   * are never reconsidered on the next scan — they just never cost a call.
   */
  rejected: { post: T; reason: RejectReason }[];
  /**
   * Posts dropped as duplicates of a kept post, mapped to the kept post that
   * stands in for them. The kept post's verdict applies to all of them.
   */
  duplicates: Map<string, T[]>;
}

// Below this there is no intent to read. The scrapers already apply their own
// per-platform floors (15-30 chars); this is the backstop for whatever gets in
// around them, including the Reddit path and rows stored before those floors
// existed.
const MIN_TEXT_LENGTH = 25;
// A post needs some actual words to express a need. Four+ letter-runs rules out
// bare link dumps, price-only Marketplace rows, and emoji walls, while still
// admitting genuinely terse asks like "need a plumber in Burnaby asap".
const MIN_WORD_COUNT = 4;

/** Collapse whitespace and case so cosmetic differences don't defeat dedup. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return (text.match(/[a-z]{2,}/gi) ?? []).length;
}

/**
 * Splits the agent's comma-separated negative keywords into matchable phrases.
 *
 * Single-word negatives are deliberately dropped. The AI prompt asks the model
 * to reject a post that is "clearly about" a negative term, which is a
 * judgment; a bare substring test is not, and one careless word ("job",
 * "sale") would silently swallow every real lead the agent has. Multi-word
 * phrases like "hiring roofer" or "roofing course" are specific enough that a
 * literal match means what the customer meant, so those are enforced here for
 * free and the single words are left for the model to weigh.
 */
export function parseNegativePhrases(negativeKeywords: string | null): string[] {
  if (!negativeKeywords) return [];
  return negativeKeywords
    .split(",")
    .map((k) => normalizeText(k))
    .filter((k) => k.length >= 6 && k.includes(" "));
}

function containsPhrase(haystack: string, phrase: string): boolean {
  // Word-boundary match so "roofing course" doesn't fire on a substring inside
  // a longer word, and escaped so a stray regex character in customer input
  // can't throw or match wildly.
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`).test(haystack);
}

/**
 * Partitions posts into those worth spending a Gemini call on and those that
 * can be resolved locally as "not relevant".
 */
export function filterPostsForAgent<T extends FilterablePost>(
  agent: Pick<AgentProfile, "negative_keywords">,
  posts: T[]
): FilterResult<T> {
  const negativePhrases = parseNegativePhrases(agent.negative_keywords);

  const kept: T[] = [];
  const rejected: { post: T; reason: RejectReason }[] = [];
  const duplicates = new Map<string, T[]>();
  // Normalized text -> the kept post that will answer for it.
  const seenText = new Map<string, T>();

  for (const post of posts) {
    const normalized = normalizeText(post.raw_text ?? "");

    if (normalized.length < MIN_TEXT_LENGTH) {
      rejected.push({ post, reason: "too_short" });
      continue;
    }

    if (wordCount(normalized) < MIN_WORD_COUNT) {
      rejected.push({ post, reason: "no_prose" });
      continue;
    }

    const hitPhrase = negativePhrases.find((phrase) => containsPhrase(normalized, phrase));
    if (hitPhrase) {
      rejected.push({ post, reason: "negative_keyword" });
      continue;
    }

    // Identical text reaching us under two different ids — the same ask
    // crossposted to a neighbourhood group and a trade group, or mirrored
    // across platforms. Storage-level dedup can't catch these because the ids
    // are genuinely different, but one AI verdict covers all of them.
    const twin = seenText.get(normalized);
    if (twin) {
      const group = duplicates.get(twin.id) ?? [];
      group.push(post);
      duplicates.set(twin.id, group);
      continue;
    }

    seenText.set(normalized, post);
    kept.push(post);
  }

  return { kept, rejected, duplicates };
}

/** Human-readable summary for the scan log, or null when nothing was filtered. */
export function describeFilter<T extends FilterablePost>(result: FilterResult<T>): string | null {
  const duplicateCount = [...result.duplicates.values()].reduce((sum, g) => sum + g.length, 0);
  const total = result.rejected.length + duplicateCount;
  if (total === 0) return null;

  const counts = new Map<RejectReason | "duplicate_text", number>();
  for (const { reason } of result.rejected) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  if (duplicateCount > 0) counts.set("duplicate_text", duplicateCount);

  const labels: Record<RejectReason, string> = {
    too_short: "too short to read intent from",
    no_prose: "no readable text",
    negative_keyword: "matched your excluded phrases",
    duplicate_text: "duplicates of another post",
  };

  const parts = [...counts.entries()].map(([reason, n]) => `${n} ${labels[reason as RejectReason]}`);
  return `Filtered out ${total} post${total === 1 ? "" : "s"} before the AI step (${parts.join(", ")}) — no credits spent on those.`;
}
