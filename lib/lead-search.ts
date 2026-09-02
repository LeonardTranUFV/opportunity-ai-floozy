/**
 * Finding real requests for a trade, anywhere in the US or Canada.
 *
 * This replaces the curated-subreddit approach, which could never have scaled:
 * every new market meant hand-picking subreddits, and picking wrong is not a
 * small error — r/vancouver is British Columbia, r/vancouverwa is Washington
 * State, and a mismatch files leads 500km away in another country under a
 * plausible-looking city name.
 *
 * Asking a search engine for the city directly removes that entirely. Any city
 * a customer types works on the first request.
 *
 * The hard part is not searching, it is throwing most of the results away.
 * A live query for `"looking for a roofer" Burnaby` came back with eight
 * results, of which exactly one was a person asking for a roofer. The rest
 * were contractor SEO pages and lead-marketplace directories — Bark, and two
 * roofing companies' own service-area pages. Filling the corpus with those
 * would show a contractor five links to the competitors we are positioning
 * against, which is worse than showing them nothing.
 *
 * So everything below is about separating "someone needs this done" from
 * "someone sells this".
 */

/** Marketplaces and directories. These are competitors, never leads. */
const BLOCKED_HOSTS = [
  "bark.com",
  "angi.com",
  "angieslist.com",
  "homeadvisor.com",
  "homestars.com",
  "thumbtack.com",
  "yelp.com",
  "houzz.com",
  "porch.com",
  "networx.com",
  "modernize.com",
  "trustedpros.ca",
  "threebestrated.ca",
  "yellowpages.ca",
  "yellowpages.com",
  "bbb.org",
  "indeed.com",
  "ziprecruiter.com",
];

/**
 * Where real people ask. Results from these rank first — a request on a
 * community site is worth more than the same words on a company blog.
 */
const COMMUNITY_HOSTS = [
  "reddit.com",
  "facebook.com",
  "nextdoor.com",
  "craigslist.org",
  "kijiji.ca",
  "quora.com",
  "city-data.com",
  "houzz.co.uk",
];

/**
 * First-person need. At least one of these must appear, which is what keeps
 * out "Find a Roofer in Burnaby" — a directory page describing what a visitor
 * might want, rather than a person saying what they want.
 */
const REQUEST_PHRASES = [
  "looking for",
  "anyone know",
  "any recommendations",
  "recommendations for",
  "can anyone recommend",
  "need a",
  "need an",
  "need someone",
  "who do you use",
  "in search of",
  "trying to find",
  "does anyone have",
  "help me find",
  "advice on finding",
];

/**
 * Sales language. One of these outweighs a request phrase, because company
 * pages routinely contain the words a customer would search for — that is the
 * entire point of a service-area page, and it is why phrase matching alone
 * lets them through.
 */
const SELLER_PHRASES = [
  "we offer",
  "our team",
  "free estimate",
  "free quote",
  "years of experience",
  "service areas",
  "serving the",
  "call us",
  "contact us today",
  "licensed and insured",
  "get a quote",
  "book online",
  "no obligation",
  "trusted by",
  "5-star",
  "fully insured",
];

export interface LeadHit {
  title: string;
  snippet: string;
  url: string;
  host: string;
  /** How well it reads as a genuine request, 1-99. */
  score: number;
  /** Stable id for upserting: the URL is the natural key. */
  externalId: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const containsAny = (text: string, phrases: string[]) => phrases.some((p) => text.includes(p));

/**
 * The queries run for one trade in one city.
 *
 * Plain phrasing only — no `site:`, no `OR`, no quoted phrases. Serper's free
 * tier rejects operator syntax outright ("Query pattern not allowed for free
 * accounts", HTTP 400), so the obvious version of this — boolean phrase
 * matching restricted to community domains — is unavailable until the account
 * is topped up. Steering toward community results is done with the word
 * "reddit" as an ordinary keyword instead, which is weaker but permitted.
 *
 * Deliberately only two. Each costs a credit, and a careless fan-out spends a
 * whole free allowance on a single city.
 */
export function queriesFor(trade: string, city: string): string[] {
  return [
    `looking for a ${trade} in ${city}`,
    `${trade} recommendations ${city} reddit`,
  ];
}

/**
 * Judges one search result.
 *
 * Returns null for anything that should never be stored. Being strict here is
 * cheap; being loose means a contractor's first impression of the product is a
 * list of their competitors' websites.
 */
export function judge(result: { title?: string; link?: string; snippet?: string }): LeadHit | null {
  const url = result.link ?? "";
  const host = hostOf(url);
  if (!host || BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) return null;

  const title = (result.title ?? "").trim();
  const snippet = (result.snippet ?? "").trim();
  const text = `${title} ${snippet}`.toLowerCase();
  if (text.length < 40) return null;

  if (!containsAny(text, REQUEST_PHRASES)) return null;
  if (containsAny(text, SELLER_PHRASES)) return null;

  const community = COMMUNITY_HOSTS.some((c) => host === c || host.endsWith(`.${c}`));

  // A community post that asks for something is the thing we are looking for;
  // everything else is a guess that happened to match a phrase.
  let score = community ? 78 : 55;
  if (/\b(asap|urgent|emergency|today|this week|right away)\b/.test(text)) score += 12;
  if (/\b(quote|estimate|budget|\$\d)/.test(text)) score += 6;
  if (/\b(my|our|we're|i'm|i am)\b/.test(text)) score += 4;
  // A question mark is weak evidence of a person rather than a page.
  if (title.includes("?")) score += 3;

  return {
    title,
    snippet,
    url,
    host,
    score: Math.max(1, Math.min(99, score)),
    externalId: url,
  };
}

/**
 * Runs the searches for one trade and city and returns what survives judging.
 *
 * Throws rather than returning empty when the key is missing or the provider
 * refuses — "no leads in your area" and "we never asked" look identical to a
 * customer and send whoever debugs it in opposite directions.
 */
export async function findLeads(
  trade: string,
  city: string,
  opts: { country?: "ca" | "us"; perQuery?: number } = {}
): Promise<LeadHit[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY is not set");

  const seen = new Map<string, LeadHit>();

  for (const q of queriesFor(trade, city)) {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        q,
        num: opts.perQuery ?? 20,
        gl: opts.country ?? "ca",
        // Recent only. A two-year-old thread is not a lead, and paying to
        // retrieve one then storing it is the expensive version of that mistake.
        tbs: "qdr:y",
      }),
    });

    if (!res.ok) {
      throw new Error(`Serper returned ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }

    const json = (await res.json()) as { organic?: Array<Record<string, string>> };
    for (const row of json.organic ?? []) {
      const hit = judge(row);
      // First sighting wins; the earlier query is the more specific one.
      if (hit && !seen.has(hit.externalId)) seen.set(hit.externalId, hit);
    }
  }

  return [...seen.values()].sort((a, b) => b.score - a.score);
}
