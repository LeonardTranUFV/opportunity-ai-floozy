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
  // A tradesperson advertising in a community group. The four-metro sweep
  // surfaced "NEED ELECTRICIAN ? 💡🤙 #PhoenixElectrician" — it contains the
  // request words because it is written to be found by people searching them.
  "dm me",
  "message me",
  "text me",
  "hmu",
  "#",
];

/**
 * Asking *about* the trade rather than *for* it.
 *
 * All three of these came out of the sweep and all three read like requests to
 * a phrase matcher: "anyone know how to get into being an electrician"
 * (career), "Exposed OSB on Canadian Roof" (DIY), "Plumbing vs. HVAC?"
 * (career). None is a person with a job to give out, and a contractor who
 * opens one has been wasted.
 */
const NOT_A_JOB = [
  "get into",
  "getting into",
  "become a",
  "apprentice",
  "apprenticeship",
  "red seal",
  "journeyman",
  "career",
  "salary",
  "how much do",
  "worth it as a",
  "school for",
  "diy",
  "do it myself",
  "myself or hire",
  "is this normal",
  "am i being ripped",
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
  /**
   * When it was posted, if the search result carried a date. Often absent —
   * treat null as "unknown", never as "today". A contractor deciding whether
   * to answer needs to know if this is two hours or two years old, and
   * inventing a date to fill the gap is the fastest way to lose their trust.
   */
  postedAt: string | null;
}

/**
 * Does the result actually concern the city that was searched?
 *
 * The sweep filed "Great Plumber Recommendation - LaLonde : r/Rochester"
 * under Calgary. Google matched the words; the post is 3,000km away. A lead in
 * the wrong city is worse than no lead — it is the specific failure that makes
 * someone cancel, because it proves the product does not understand the one
 * thing they asked for.
 *
 * The city name (or its first word, so "Toronto ON" matches "Toronto") has to
 * appear somewhere in the text. Imperfect — a genuine post that names only a
 * neighbourhood is dropped — but the cost of a false positive here is much
 * higher than a false negative, since we are choosing which handful to show.
 */
function mentionsCity(text: string, city: string): boolean {
  const core = city.toLowerCase().split(/[ ,]/)[0];
  if (core.length < 3) return true;
  return text.includes(core);
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
    // The words people actually type when they need someone. The four-metro
    // sweep returned 4-8 genuine requests per pair on this shape.
    `looking for a ${trade} in ${city}`,
    // "recommendations" is what community posts are titled, and "reddit"
    // steers toward the venue where those posts live — the closest thing to a
    // site: restriction the free tier permits.
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
export function judge(
  result: { title?: string; link?: string; snippet?: string; date?: string },
  city?: string
): LeadHit | null {
  const url = result.link ?? "";
  const host = hostOf(url);
  if (!host || BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) return null;

  const title = (result.title ?? "").trim();
  const snippet = (result.snippet ?? "").trim();
  const text = `${title} ${snippet}`.toLowerCase();
  if (text.length < 40) return null;

  if (!containsAny(text, REQUEST_PHRASES)) return null;
  if (containsAny(text, SELLER_PHRASES)) return null;
  if (containsAny(text, NOT_A_JOB)) return null;
  if (city && !mentionsCity(text, city)) return null;

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
    postedAt: parseResultDate(result.date),
  };
}

/**
 * Search results carry dates like "3 days ago", "Feb 14, 2026", or nothing at
 * all. Null when it cannot be read — an unknown date is shown as unknown, and
 * never quietly defaulted to now. Age is most of what decides whether a lead
 * is worth answering, so a wrong one is worse than none.
 */
function parseResultDate(raw?: string): string | null {
  if (!raw) return null;

  const relative = raw.match(/(\d+)\s+(hour|day|week|month|year)s?\s+ago/i);
  if (relative) {
    const n = Number(relative[1]);
    const ms: Record<string, number> = {
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_592_000_000,
      year: 31_536_000_000,
    };
    return new Date(Date.now() - n * ms[relative[2].toLowerCase()]).toISOString();
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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
      const hit = judge(row, city);
      // First sighting wins; the earlier query is the more specific one.
      if (hit && !seen.has(hit.externalId)) seen.set(hit.externalId, hit);
    }
  }

  return [...seen.values()].sort((a, b) => b.score - a.score);
}
