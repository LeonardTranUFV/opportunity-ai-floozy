import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The morning lead digest: which leads a client gets, and the spreadsheet of
 * them.
 *
 * Lifted out of scripts/send-daily-leads.ts so the scheduled job and the local
 * script are the same rules rather than two drifting copies. The selection is
 * unchanged from the version that has been emailing contractors since
 * 2026-09-30; what is new is that it reads its recipients from the database
 * and records what it sent there too.
 *
 * What goes out:
 *   - scored MIN_SCORE or better
 *   - posted in the last 7 days, split into "fresh" (3 days or less) and
 *     "this week" by the post's own date — plain arithmetic, no model
 *   - or no post date at all (most Facebook posts), first seen in the last 3
 *     days, in a clearly separate "date unknown" group so nobody mistakes it
 *     for confirmed-fresh
 *   - never sent to this recipient before
 */

export const MIN_SCORE = 60;
export const FRESH_DAYS = 3;
export const WEEK_DAYS = 7;
export const UNDATED_SEEN_DAYS = 3;
const DAY_MS = 86_400_000;

export type Bucket = "Fresh (last 3 days)" | "This week" | "Date unknown";

export interface Lead {
  id: string;
  bucket: Bucket;
  postedAt: Date | null;
  score: number;
  urgency: string;
  category: string;
  location: string;
  phone: string;
  estimatedValue: string;
  summary: string;
  text: string;
  postUrl: string;
  profileUrl: string;
  platform: string;
  author: string;
}

/**
 * The leads for one client, newest and most urgent first.
 *
 * `agentIds` empty means every agent on the account. A single-client operator
 * would otherwise have to keep a list that is always "all of them", and the
 * day they add an agent and forget, their client silently stops getting half
 * their leads.
 */
export async function collectLeads(
  sb: SupabaseClient,
  opts: { userId: string; agentIds: string[]; alreadySent: Set<string>; now?: number }
): Promise<Lead[]> {
  const now = opts.now ?? Date.now();
  // An opportunity is created when a post is scored, always after the post was
  // scraped, so nothing posted within the week can be older than this.
  const since = new Date(now - (WEEK_DAYS + 1) * DAY_MS).toISOString();

  let query = sb
    .from("opportunities")
    .select(
      "id,source_post_id,platform,author_name,author_profile_url,post_url,location_mentioned,phone_number,estimated_value,content,category,intent_score,urgency,ai_summary,created_at"
    )
    .eq("user_id", opts.userId)
    .gte("intent_score", MIN_SCORE)
    .gte("created_at", since);
  if (opts.agentIds.length > 0) query = query.in("agent_id", opts.agentIds);

  const { data: opps, error } = await query;
  if (error) throw new Error(error.message);

  // The post rows carry the two dates the buckets are decided by.
  const postIds = [...new Set((opps ?? []).map((o) => o.source_post_id).filter(Boolean))] as string[];
  const posts = new Map<string, { posted_at: string | null; scraped_at: string }>();
  for (let i = 0; i < postIds.length; i += 200) {
    const { data, error: pErr } = await sb
      .from("posts")
      .select("id,posted_at,scraped_at")
      .in("id", postIds.slice(i, i + 200));
    if (pErr) throw new Error(pErr.message);
    for (const p of data ?? []) posts.set(p.id, p);
  }

  const dated: Lead[] = [];
  const undated: Lead[] = [];

  for (const o of opps ?? []) {
    if (opts.alreadySent.has(o.id)) continue;

    const post = o.source_post_id ? posts.get(o.source_post_id) : undefined;
    const parsed = post?.posted_at ? new Date(post.posted_at) : null;
    const postedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;

    const lead: Lead = {
      id: o.id,
      bucket: "Date unknown",
      postedAt,
      score: o.intent_score ?? 0,
      urgency: o.urgency ?? "",
      category: o.category ?? "",
      location: o.location_mentioned ?? "",
      phone: o.phone_number ?? "",
      estimatedValue: o.estimated_value ?? "",
      summary: o.ai_summary ?? "",
      text: o.content ?? "",
      postUrl: o.post_url ?? "",
      profileUrl: o.author_profile_url ?? "",
      platform: o.platform ?? "",
      author: o.author_name ?? "",
    };

    if (lead.postedAt) {
      const ageDays = (now - lead.postedAt.getTime()) / DAY_MS;
      if (ageDays > WEEK_DAYS) continue;
      lead.bucket = ageDays <= FRESH_DAYS ? "Fresh (last 3 days)" : "This week";
      dated.push(lead);
    } else {
      const seen = new Date(post?.scraped_at ?? o.created_at).getTime();
      if (now - seen <= UNDATED_SEEN_DAYS * DAY_MS) undated.push(lead);
    }
  }

  const order: Bucket[] = ["Fresh (last 3 days)", "This week", "Date unknown"];
  return [...dated, ...undated].sort(
    (a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket) || b.score - a.score
  );
}

/**
 * The columns, in the order a contractor reads them: how fresh, how good, who
 * and where, then how to reach them, then the evidence.
 *
 * A missing value is left blank rather than dropping the lead. Phone is the
 * reason: people asking a Facebook group for a plumber almost never type their
 * number, so requiring one would throw away most of what the product finds.
 * The one thing a lead cannot be without is a link to the post, because
 * without it there is nothing to act on — those are dropped by `toCsv`.
 */
const COLUMNS = [
  "Freshness",
  "Posted",
  "Score",
  "Urgency",
  "Category",
  "Location",
  "Phone",
  "Est. value",
  "What they need",
  "Post text",
  "Post link",
  "Profile link",
  "Platform",
  "Author",
] as const;

export function toCsv(leads: Lead[]): string {
  const rows = leads.filter((l) => l.postUrl).map((l) => [
    l.bucket,
    l.postedAt ? l.postedAt.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "",
    String(l.score),
    l.urgency,
    l.category,
    l.location,
    l.phone,
    l.estimatedValue,
    l.summary,
    l.text,
    l.postUrl,
    l.profileUrl,
    l.platform,
    l.author,
  ]);
  // BOM so Excel opens it as UTF-8 rather than mangling accents and emoji.
  return "﻿" + [COLUMNS as readonly string[], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function csvCell(v: string): string {
  // A leading = + - @ makes Excel run the cell as a formula, and this text was
  // written by strangers on the internet.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** "4 fresh, 2 this week, 1 undated" — for the subject line and the UI. */
export function countBuckets(leads: Lead[]): string {
  const n = (b: Bucket) => leads.filter((l) => l.bucket === b).length;
  return [
    n("Fresh (last 3 days)") ? `${n("Fresh (last 3 days)")} fresh` : "",
    n("This week") ? `${n("This week")} this week` : "",
    n("Date unknown") ? `${n("Date unknown")} undated` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export function emailHtml(name: string, leads: Lead[]): string {
  const rows = leads
    .slice(0, 15)
    .map(
      (l) =>
        `<tr><td>${esc(l.bucket)}</td><td>${l.score}</td>` +
        `<td>${esc(l.summary || l.text.slice(0, 140))}</td>` +
        `<td>${esc(l.location)}</td>` +
        `<td>${l.postUrl ? `<a href="${esc(l.postUrl)}">open</a>` : ""}</td></tr>`
    )
    .join("");
  return `<p>Hi ${esc(name)},</p>
<p>${leads.length} new lead${leads.length === 1 ? "" : "s"} this morning (${esc(countBuckets(leads))}).
Top ones below; all of them are in the attached spreadsheet, with the post link, the profile link and a phone number where one was given.</p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
<tr><th>When</th><th>Score</th><th>What they need</th><th>Where</th><th>Post</th></tr>${rows}</table>
<p style="color:#666;font-size:12px">"Date unknown" means the platform didn't show when it was posted; we first saw it in the last ${UNDATED_SEEN_DAYS} days.</p>`;
}

/**
 * Is it this recipient's send hour, and have they already had today's?
 *
 * Both questions are asked in the recipient's own timezone. The job runs every
 * hour precisely so that "8am" can mean a different instant for a client in
 * Vancouver and one in Hanoi.
 */
export function localParts(timezone: string, at = new Date()): { hour: number; date: string } {
  let tz = timezone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    // An unknown zone must not stop the send; UTC at least goes out.
    tz = "UTC";
  }
  const hour = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", hour12: false }).format(at)
  );
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return { hour, date };
}

export function isDue(
  recipient: { send_hour: number; timezone: string; last_sent_on: string | null },
  at = new Date()
): boolean {
  const { hour, date } = localParts(recipient.timezone, at);
  if (hour !== recipient.send_hour) return false;
  return recipient.last_sent_on !== date;
}
