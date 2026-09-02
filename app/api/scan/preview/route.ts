import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import { findLeads } from "@/lib/lead-search";

/**
 * The free scan: what a stranger sees before they have an account.
 *
 * Reads the cache first and only pays for a search when there is nothing
 * fresh. That ordering is the whole cost model — a search costs credits, a
 * cache hit costs nothing, and the same city gets asked for repeatedly once
 * ads are running. Filling on demand also means every city in the US and
 * Canada works on the first request, rather than only the ones somebody
 * curated in advance.
 *
 * Three things protect the route, since it is the only unauthenticated handler
 * that returns data:
 *
 *   **It never returns a way to reach the person.** `source_url` is stored and
 *   deliberately not selected. The post text is the proof; the link is the
 *   product. Give away both and there is nothing to charge for, and a scraper
 *   in a loop walks off with the corpus.
 *
 *   **It reads only `public_leads`** — never `opportunities`, never
 *   `pooled_opportunities`. Those belong to customers who consented to
 *   something else entirely. See the header of migration 0012.
 *
 *   **It is limited by IP**, on the strict bucket, because there is no account
 *   to limit by and each miss spends real money.
 */

export const dynamic = "force-dynamic";

/** Shown in full before the ask. */
const FREE_ROWS = 3;
/** How many we look at, so we can say how many more are waiting. */
const PEEK_ROWS = 40;
/** Older than this and it is history, not a lead. */
const MAX_AGE_DAYS = 90;
/**
 * How long a filled area stays fresh.
 *
 * Long enough that a market being advertised into is paid for roughly once a
 * week; short enough that the leads on screen are not stale. The trade-off is
 * money against freshness and this is the middle of it.
 */
const CACHE_DAYS = 7;

interface Body {
  trade?: unknown;
  city?: unknown;
}

/**
 * Free text in, matchable value out. Someone types "Roofing", "roofer" or
 * "Roofs" — all one trade, and the corpus stores one of them.
 */
const TRADE_ALIASES: Record<string, string> = {
  roof: "roofing", roofer: "roofing", roofing: "roofing", roofs: "roofing",
  paint: "painting", painter: "painting", painting: "painting",
  plumb: "plumbing", plumber: "plumbing", plumbing: "plumbing",
  electric: "electrical", electrician: "electrical", electrical: "electrical",
  floor: "flooring", flooring: "flooring", laminate: "flooring",
  landscaper: "landscaping", landscaping: "landscaping", lawn: "landscaping",
  hvac: "hvac", furnace: "hvac", heating: "hvac",
  reno: "renovation", renovation: "renovation", contractor: "renovation",
  handyman: "handyman", drywall: "drywall", fencing: "fencing", fence: "fencing",
  concrete: "concrete", tiler: "tiling", tiling: "tiling",
};

/** Which Google locale to search. Rough, and only affects result ranking. */
const CA_HINTS = [
  "bc", "ab", "on", "qc", "ns", "nb", "mb", "sk", "canada", "ontario", "alberta",
  "vancouver", "toronto", "calgary", "edmonton", "ottawa", "montreal", "winnipeg",
  "burnaby", "surrey", "richmond", "coquitlam", "hamilton", "kitchener", "halifax",
];

function normaliseTrade(raw: string): string | null {
  const cleaned = raw.toLowerCase().trim().replace(/[^a-z ]/g, "");
  if (!cleaned) return null;
  if (TRADE_ALIASES[cleaned]) return TRADE_ALIASES[cleaned];
  for (const word of cleaned.split(/\s+/)) if (TRADE_ALIASES[word]) return TRADE_ALIASES[word];
  return cleaned.slice(0, 40);
}

function normaliseCity(raw: string): string | null {
  const cleaned = raw.toLowerCase().trim();
  if (!cleaned) return null;
  // PostgREST reads , ( ) * as operators inside a filter value — the same
  // escaping bug already fixed on Opportunities search and on the pool.
  return cleaned.replace(/[,()*]/g, "").slice(0, 60);
}

/** First entry of x-forwarded-for is the client; the rest are proxies. */
function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  // @public-route — answers visitors who have no account, by design. It is the
  // page ads point at. Compensating controls, in place of a session check: the
  // strict per-IP rate limit below, reads confined to `public_leads` (never a
  // customer's rows), and source_url withheld from the response.
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

  const admin = createAdminClient();
  const since = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();

  const read = async () =>
    admin
      .from("public_leads")
      // No source_url. See the header — the link is the thing being sold.
      .select("id,content,trade,city,region,source,posted_at,intent_score,created_at")
      .eq("trade", trade)
      .ilike("city", `%${city}%`)
      .or(`posted_at.is.null,posted_at.gte.${since}`)
      .order("intent_score", { ascending: false })
      .limit(PEEK_ROWS);

  let { data, error } = await read();

  if (error) {
    const missing = /public_leads/.test(error.message);
    console.error(`[scan] preview read failed: ${error.message}`);
    return NextResponse.json(
      {
        error: missing
          ? "The scan is not set up yet — migration 0012_public_leads.sql has not been applied."
          : "Something went wrong looking. Try again in a moment.",
      },
      { status: 500 }
    );
  }

  // Has this area been filled recently? Age of the newest row, not the count —
  // an area that genuinely has two leads should not be re-searched every visit.
  const freshestFill = (data ?? [])
    .map((r) => Date.parse(r.created_at as string))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const stale = !freshestFill || Date.now() - freshestFill > CACHE_DAYS * 86_400_000;

  let searched = false;

  if (stale && process.env.SERPER_API_KEY) {
    searched = true;
    try {
      const country = CA_HINTS.some((h) => city.includes(h)) ? "ca" : "us";
      const hits = await findLeads(trade, city, { country });

      if (hits.length) {
        await admin.from("public_leads").upsert(
          hits.map((h) => ({
            source: "web",
            source_url: h.url,
            external_id: h.url,
            posted_at: h.postedAt,
            content: h.snippet ? `${h.title} — ${h.snippet}` : h.title,
            trade,
            city,
            intent_score: h.score,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "source,external_id" }
        );
        ({ data, error } = await read());
      }
    } catch (searchError) {
      // Never fatal. A failed search means we serve whatever is cached, which
      // is the honest degraded answer — telling someone the product is broken
      // when we simply could not refresh would be worse.
      console.error(
        `[scan] search failed for ${trade}/${city}:`,
        searchError instanceof Error ? searchError.message : searchError
      );
    }
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
    /** True when we hit our own cap, so "40+" is honest rather than "40". */
    capped: rows.length === PEEK_ROWS,
    /** Whether this request paid for a live search, for cost tracking. */
    searched,
  });
}
