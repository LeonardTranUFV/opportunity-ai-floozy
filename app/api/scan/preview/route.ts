import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

/**
 * The free scan: what a stranger sees before they have an account.
 *
 * This is the only unauthenticated route in the app that returns data, so it
 * is written defensively in three specific ways.
 *
 * **It never returns a way to reach the person.** `source_url` exists on every
 * row and is deliberately not selected. The post text is the proof; the link
 * is the product. Handing both over free leaves nothing to charge for, and a
 * scraper that hit this endpoint in a loop would walk off with the corpus.
 *
 * **It reads only `public_leads`.** Never `opportunities`, never
 * `pooled_opportunities` — see the header of migration 0012. Those rows belong
 * to customers who consented to something else.
 *
 * **It is limited by IP, not by account.** There is no account. `strict`
 * (5 per 15 minutes) is the right bucket: a real person runs one scan, maybe
 * two if they mistype their city.
 */

export const dynamic = "force-dynamic";

/** How many rows a free scan shows before the paywall. */
const FREE_ROWS = 3;
/** How many we look at, so we can say how many more are waiting. */
const PEEK_ROWS = 40;
/** Anything older than this is not a lead any more, it is history. */
const MAX_AGE_DAYS = 90;

interface Body {
  trade?: unknown;
  city?: unknown;
}

/**
 * Free text in, matchable value out. Someone types "Roofing", "roofer",
 * "Roofs" — all the same trade, and the corpus stores one of them.
 */
const TRADE_ALIASES: Record<string, string> = {
  roof: "roofing",
  roofer: "roofing",
  roofing: "roofing",
  paint: "painting",
  painter: "painting",
  painting: "painting",
  plumb: "plumbing",
  plumber: "plumbing",
  plumbing: "plumbing",
  electric: "electrical",
  electrician: "electrical",
  electrical: "electrical",
  floor: "flooring",
  flooring: "flooring",
  landscaper: "landscaping",
  landscaping: "landscaping",
  hvac: "hvac",
  furnace: "hvac",
  reno: "renovation",
  renovation: "renovation",
  contractor: "renovation",
};

function normaliseTrade(raw: string): string | null {
  const cleaned = raw.toLowerCase().trim().replace(/[^a-z ]/g, "");
  if (!cleaned) return null;
  if (TRADE_ALIASES[cleaned]) return TRADE_ALIASES[cleaned];
  // Try each word, so "roofing contractor" and "residential plumber" resolve.
  for (const word of cleaned.split(/\s+/)) {
    if (TRADE_ALIASES[word]) return TRADE_ALIASES[word];
  }
  return cleaned.slice(0, 40);
}

function normaliseCity(raw: string): string | null {
  const cleaned = raw.toLowerCase().trim();
  if (!cleaned) return null;
  // PostgREST reads , ( ) * as operators inside a filter value — the same
  // escaping bug already fixed on Opportunities search and on the pool.
  return cleaned.replace(/[,()*]/g, "").slice(0, 60);
}

/**
 * The caller's IP, for rate limiting. Vercel sets x-forwarded-for; the first
 * entry is the client and the rest are proxies, so anything after the first
 * comma is theirs, not the caller's.
 */
function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  // @public-route — answers visitors who have no account, by design. It is the
  // page ads point at. Compensating controls, in place of a session check:
  // a strict per-IP rate limit below, reads confined to `public_leads` (never
  // a customer's rows), and source_url withheld from the response.
  const rl = await rateLimit(
    `scan-preview:${callerIp(request)}`,
    LIMITS.strict.limit,
    LIMITS.strict.windowMs
  );
  if (!rl.allowed) return tooManyRequests(rl, "scans");

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const trade = typeof body.trade === "string" ? normaliseTrade(body.trade) : null;
  const city = typeof body.city === "string" ? normaliseCity(body.city) : null;

  if (!trade || !city) {
    return NextResponse.json(
      { error: "Tell us your trade and your city and we'll look." },
      { status: 400 }
    );
  }

  const since = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("public_leads")
    // No source_url. See the header — the link is the thing being sold.
    .select("id,content,trade,city,region,source,posted_at,intent_score")
    .eq("trade", trade)
    .ilike("city", `%${city}%`)
    .gte("posted_at", since)
    .order("posted_at", { ascending: false })
    .limit(PEEK_ROWS);

  if (error) {
    // A missing table means migration 0012 has not been applied. Say which,
    // rather than reporting an empty corpus — "no leads in your area" and
    // "the table does not exist" send whoever debugs it to opposite ends of
    // the system.
    const missing = /public_leads/.test(error.message);
    console.error(`[scan] preview failed: ${error.message}`);
    return NextResponse.json(
      {
        error: missing
          ? "The scan is not set up yet — migration 0012_public_leads.sql has not been applied."
          : "Something went wrong looking. Try again in a moment.",
      },
      { status: 500 }
    );
  }

  const rows = data ?? [];

  return NextResponse.json({
    trade,
    city,
    total: rows.length,
    /** Shown in full. */
    shown: rows.slice(0, FREE_ROWS),
    /** Counted, not shown — this number is the paywall's whole argument. */
    locked: Math.max(0, rows.length - FREE_ROWS),
    /** True when we looked at our cap, so "40+" is honest rather than "40". */
    capped: rows.length === PEEK_ROWS,
  });
}
