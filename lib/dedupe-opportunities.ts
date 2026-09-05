import { isExactPostUrl } from "@/lib/post-url";

/**
 * Collapse duplicate opportunities at read time.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Two bugs, both fixed at the source on 2026-09-05, left one agent's lead
 * list at 706 rows for 223 genuinely distinct asks: the "already scored?"
 * lookup was silently truncated at 1,000 rows so posts past the cap were
 * re-scored on every scan, and Facebook's two id shapes for one story stored
 * the same post twice. Neither fix touches the rows already there.
 *
 * The permanent clean is a migration (0017) that deletes the extras and adds
 * a unique index so it cannot recur. Until that has been run, every screen
 * that shows or counts opportunities goes through here, so the customer sees
 * 223 and not 706 — and when the migration has run, this becomes a no-op
 * that costs one pass over rows already in memory.
 *
 * ── Which copy survives ────────────────────────────────────────────────────
 *
 * Duplicates are the same ask, so the question is only which row to show.
 * Anything the customer has acted on wins: a status they set, an outreach
 * they sent. Then the copy they can act on best — a profile to message, a
 * real name, a permalink — matching how the scan already chooses between
 * twins. Then the newest. Deleting the others is exactly what the migration
 * does, with the same ordering, so what they see now is what they keep.
 */

export interface DedupableOpportunity {
  id: string;
  agent_id: string | null;
  content: string | null;
  status?: string | null;
  author_name?: string | null;
  author_profile_url?: string | null;
  post_url?: string | null;
  comment_sent_at?: string | null;
  dm_sent_at?: string | null;
  created_at?: string | null;
}

/** Same normalisation the scan uses to spot twins. */
export function opportunityKey(o: DedupableOpportunity): string {
  const text = (o.content ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300);
  return `${o.agent_id ?? ""}|${text}`;
}

const STATUS_RANK: Record<string, number> = {
  won: 6,
  proposal: 5,
  appointment: 4,
  qualified: 3,
  contacted: 2,
  // A deliberate "lost" is still a decision, and beats a row nobody looked at.
  lost: 1,
  new: 0,
};

const PLACEHOLDER_AUTHORS = new Set(["anonymous member", "anonymous participant", "linkedin professional", "x user"]);

function keepScore(o: DedupableOpportunity): number {
  const status = (STATUS_RANK[o.status ?? "new"] ?? 0) * 1000;
  const acted = o.comment_sent_at || o.dm_sent_at ? 100 : 0;
  const profile = o.author_profile_url ? 40 : 0;
  const named = PLACEHOLDER_AUTHORS.has((o.author_name ?? "").trim().toLowerCase()) ? 0 : 20;
  const link = isExactPostUrl(o.post_url ?? null) ? 10 : 0;
  return status + acted + profile + named + link;
}

/**
 * One row per (agent, ask). Order of the input is preserved for survivors,
 * so a list sorted by score stays sorted.
 */
export function dedupeOpportunities<T extends DedupableOpportunity>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = opportunityKey(row);
    const held = best.get(key);
    if (!held) {
      best.set(key, row);
      continue;
    }
    const a = keepScore(row);
    const b = keepScore(held);
    const newer = (row.created_at ?? "") > (held.created_at ?? "");
    if (a > b || (a === b && newer)) best.set(key, row);
  }
  const keep = new Set([...best.values()].map((r) => r.id));
  return rows.filter((r) => keep.has(r.id));
}
