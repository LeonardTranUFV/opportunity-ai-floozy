import { formatAuthLaunchError } from "@/lib/auth-session";
import { openPlatformContext } from "@/lib/browser-context";
import { isHostedDeployment } from "@/lib/deployment";
import { attachFeedCapture } from "@/lib/feed-capture";
import { DomainThrottle, fetchPaced } from "@/lib/fetchers";
import { getRedditToken, toOAuthUrl, REDDIT_USER_AGENT, REDDIT_SETUP_HINT } from "@/lib/reddit-auth";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const randBetween = (min: number, max: number) => min + Math.floor(Math.random() * (max - min));

export interface GroupToScrape {
  id: string;
  platform: string;
  name: string;
  url: string;
}

export interface ScrapedPost {
  group_id: string;
  platform: string;
  external_post_id: string;
  post_url: string | null;
  author_name: string;
  author_profile_url: string | null;
  posted_at: string | null;
  raw_text: string;
}

interface RawExtractedPost {
  post_id: string;
  post_url: string | null;
  author_name: string;
  author_profile_url: string | null;
  timestamp: string | null;
  raw_text: string;
}

/**
 * Runs inside the Facebook page. Extracts whatever posts are currently
 * mounted in the (virtualized) feed DOM — ported from the legacy
 * scrape-social-demands.js crawler, unchanged extraction logic.
 */
function extractFacebookPosts(groupUrl: string): RawExtractedPost[] {
  const results: RawExtractedPost[] = [];
  const seenTexts = new Set<string>();
  const postContainers = document.querySelectorAll('div[role="feed"] > div, div[role="article"]');

  const parseRelativeAge = (container: Element): string | null => {
    const candidates = container.querySelectorAll("a, abbr, span");
    for (const el of candidates) {
      const label = (el.getAttribute("aria-label") || el.textContent || "").trim();
      const m = label.match(/^(\d{1,2})\s*(m|h|d|w)$/i);
      if (m) {
        const value = parseInt(m[1], 10);
        const unitMs = { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 }[m[2].toLowerCase() as "m" | "h" | "d" | "w"];
        return new Date(Date.now() - value * unitMs).toISOString();
      }
      if (/^yesterday/i.test(label)) {
        return new Date(Date.now() - 86400e3).toISOString();
      }
    }
    return null;
  };

  const hashText = (str: string): string => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  };

  const getMessage = (container: Element): string => {
    const adPrev = container.querySelector('div[data-ad-preview="message"]');
    if (adPrev && (adPrev.textContent || "").trim().length > 20) return (adPrev.textContent || "").trim();
    let best = "";
    container.querySelectorAll('div[dir="auto"]').forEach((el) => {
      const t = (el.textContent || "").trim();
      if (t.length > best.length) best = t;
    });
    return best;
  };

  postContainers.forEach((container) => {
    if ((container.textContent || "").trim().length < 30) return;

    const authorElement = container.querySelector("h2 a, h3 a, strong a");
    const raw_text = getMessage(container).slice(0, 1500);
    const author_name = authorElement ? (authorElement.textContent || "").trim() : "Anonymous Member";
    const authorHref = authorElement ? authorElement.getAttribute("href") : null;
    // Unlike post_url below, this was never resolved to an absolute URL —
    // Facebook's author anchors are relative ("/groups/.../user/123/?__cft__..."),
    // which is a broken link once stored and clicked from outside facebook.com.
    const author_profile_url = authorHref
      ? (authorHref.startsWith("http") ? authorHref : window.location.origin + authorHref).split("?")[0]
      : null;

    if (!raw_text || raw_text.length <= 20) return;

    const textKey = raw_text.slice(0, 160).toLowerCase().replace(/\s+/g, " ");
    if (seenTexts.has(textKey)) return;
    seenTexts.add(textKey);

    let directUrl: string | null = null;
    container.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (
        href.includes("/share/p/") ||
        href.includes("/posts/") ||
        href.includes("/permalink.php") ||
        href.includes("/permalink/")
      ) {
        try {
          const resolvedUrl = href.startsWith("http") ? href : window.location.origin + href;
          directUrl = resolvedUrl.split("?")[0];
        } catch {}
      }
    });

    const finalPostUrl = directUrl || groupUrl;
    const uniquePostId = directUrl
      ? `fb_${(directUrl as string).replace(/[^a-zA-Z0-9]/g, "_")}`
      : `fb_txt_${hashText(textKey)}`;

    results.push({
      post_id: uniquePostId,
      post_url: finalPostUrl,
      author_name,
      author_profile_url,
      timestamp: parseRelativeAge(container),
      raw_text,
    });
  });

  return results;
}

/** Same incremental-extraction contract, for LinkedIn feeds/search results. */
function extractLinkedInPosts(groupUrl: string): RawExtractedPost[] {
  const results: RawExtractedPost[] = [];
  const seenTexts = new Set<string>();
  const postContainers = document.querySelectorAll("div.feed-shared-update-v2, div.search-content__result");

  const parseRelativeAge = (container: Element): string | null => {
    const el = container.querySelector("span.feed-shared-actor__sub-description, time");
    const label = el ? (el.textContent || "").trim() : "";
    const m = label.match(/(\d{1,2})\s*(m|mo|h|d|w)\b/i);
    if (m) {
      const unit = m[2].toLowerCase();
      const unitMs = { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3, mo: 2592000e3 }[unit];
      if (unitMs) return new Date(Date.now() - parseInt(m[1], 10) * unitMs).toISOString();
    }
    return null;
  };

  const hashText = (str: string): string => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  };

  postContainers.forEach((container) => {
    const textElement = container.querySelector("span.break-words, div.feed-shared-update-v2__description");
    const authorElement = container.querySelector("span.feed-shared-actor__title, span.feed-shared-actor__name");

    const raw_text = textElement ? (textElement.textContent || "").trim() : "";
    const author_name = authorElement ? (authorElement.textContent || "").trim() : "LinkedIn Professional";
    const authorHref = container.querySelector("a.feed-shared-actor__image-link")?.getAttribute("href") || null;
    const author_profile_url = authorHref
      ? (authorHref.startsWith("http") ? authorHref : window.location.origin + authorHref).split("?")[0]
      : null;

    if (!raw_text || raw_text.length <= 25) return;

    const textKey = raw_text.slice(0, 160).toLowerCase().replace(/\s+/g, " ");
    if (seenTexts.has(textKey)) return;
    seenTexts.add(textKey);

    let directUrl: string | null = null;
    const permalinkAnchor = container.querySelector("a.feed-shared-update-v2__sub-text-link");
    if (permalinkAnchor) {
      const href = permalinkAnchor.getAttribute("href") || "";
      directUrl = href.startsWith("http") ? href : window.location.origin + href;
      directUrl = directUrl.split("?")[0];
    }

    results.push({
      post_id: `li_${directUrl ? directUrl.replace(/[^a-zA-Z0-9]/g, "_") : "txt_" + hashText(textKey)}`,
      post_url: directUrl || groupUrl,
      author_name,
      author_profile_url,
      timestamp: parseRelativeAge(container),
      raw_text,
    });
  });

  return results;
}

/**
 * Nextdoor DOM structure, unlike Facebook/LinkedIn's, hasn't been confirmed
 * against a real logged-in session (no test account available while writing
 * this) — selectors below are an educated guess based on Nextdoor's public
 * markup conventions (semantic <time datetime> elements, /p/<slug> post
 * permalinks). Treat the first live scrape as the real test; if it returns
 * zero posts from an active neighborhood feed, inspect the actual DOM and
 * adjust the selectors here.
 */
/**
 * Confirmed against a real logged-in session (2026-07-28) — Nextdoor's feed
 * has no <time datetime> elements at all (unlike Facebook/LinkedIn), so
 * relative age has to be parsed from the plain text inside
 * [data-testid="post-timestamp"] ("1 day ago", "5 days ago", "19 hr ago").
 * There's also no per-post permalink anchor in the feed view — posts only
 * get a real URL once you click into them — so post_url falls back to the
 * neighborhood feed URL and dedup relies on a text hash instead.
 */
function extractNextdoorPosts(groupUrl: string): RawExtractedPost[] {
  const results: RawExtractedPost[] = [];
  const seenTexts = new Set<string>();
  const postContainers = document.querySelectorAll("div.post");

  const hashText = (str: string): string => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  };

  const parseRelativeAge = (label: string): string | null => {
    const m = label.match(/(\d{1,3})\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks)\s*ago/i);
    if (!m) return null;
    const value = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const unitMs = unit.startsWith("min")
      ? 60e3
      : unit.startsWith("hr") || unit.startsWith("hour")
        ? 3600e3
        : unit.startsWith("day")
          ? 86400e3
          : 604800e3;
    return new Date(Date.now() - value * unitMs).toISOString();
  };

  postContainers.forEach((container) => {
    const profileAnchors = [...container.querySelectorAll('a[href*="/profile/"]')] as HTMLAnchorElement[];
    const authorAnchor = profileAnchors.reduce<HTMLAnchorElement | null>((best, a) => {
      const text = (a.textContent || "").trim();
      const bestText = best ? (best.textContent || "").trim() : "";
      return text.length > bestText.length ? a : best;
    }, null);
    const author_name = authorAnchor ? (authorAnchor.textContent || "").trim() : "Neighbor";
    const author_profile_url = authorAnchor ? authorAnchor.getAttribute("href") : null;

    const bodyEl = container.querySelector('[data-testid="post-body"]');
    const raw_text = bodyEl ? (bodyEl.textContent || "").trim().slice(0, 1500) : "";
    if (!raw_text || raw_text.length <= 20) return;

    const textKey = raw_text.slice(0, 160).toLowerCase().replace(/\s+/g, " ");
    if (seenTexts.has(textKey)) return;
    seenTexts.add(textKey);

    const timestampEl = container.querySelector('[data-testid="post-timestamp"]');
    const timestamp = timestampEl ? parseRelativeAge((timestampEl.textContent || "").trim()) : null;

    const resolvedProfileUrl = author_profile_url
      ? author_profile_url.startsWith("http")
        ? author_profile_url
        : window.location.origin + author_profile_url
      : null;

    results.push({
      post_id: `nd_txt_${hashText(textKey)}`,
      post_url: groupUrl,
      author_name,
      author_profile_url: resolvedProfileUrl,
      timestamp,
      raw_text,
    });
  });

  return results;
}

/** X (Twitter) search-results timeline — `data-testid` hooks are the stable, documented markers X itself uses for automated testing, so these are lower-risk than the Nextdoor guesses above. Still unverified live. */
/**
 * Which saved login a source type actually uses. Marketplace has no login of
 * its own — it's Facebook — so it must resolve to the Facebook session both
 * for the profile directory and for concurrency bucketing.
 */
export function sessionPlatform(platform: string): string {
  return platform === "marketplace" ? "facebook" : platform;
}

/**
 * Facebook Marketplace listings.
 *
 * Written against the real DOM (verified live, not guessed): every listing is
 * an `a[href*="/marketplace/item/<id>"]` whose innerText is a short line stack
 * of the shape
 *     ["Just listed"?, "CA$120", "Title of the listing", "Burnaby, BC"]
 * — the "Just listed" badge and a strikethrough original price are both
 * optional, so lines are classified by pattern rather than by position.
 *
 * Worth knowing what this source actually is: Marketplace skews heavily toward
 * people ADVERTISING services rather than asking for them, so for a contractor
 * most results are competitors. It earns its place for buy/sell, rental and
 * "in search of" style goals — the AI scoring step is what separates a real
 * request from another supplier's ad.
 */
// groupUrl is unused here but the parameter has to stay: every extractor is
// shipped into the page by the same `page.evaluate(extractor, group.url)`
// call, so they all share one signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractMarketplaceListings(groupUrl: string): RawExtractedPost[] {
  const results: RawExtractedPost[] = [];
  const seen = new Set<string>();

  document.querySelectorAll('a[href*="/marketplace/item/"]').forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const id = (href.match(/\/marketplace\/item\/(\d+)/) || [])[1];
    if (!id || seen.has(id)) return;
    seen.add(id);

    const lines = (anchor.textContent ? (anchor as HTMLElement).innerText : "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const isPrice = (s: string) => /^(CA)?\$[\d,]+/.test(s) || /^free$/i.test(s);
    const isBadge = (s: string) => /^just listed$/i.test(s);
    // Location is the trailing "City, PROV" line; titles rarely match this.
    const isLocation = (s: string) => /,\s*[A-Z]{2}$/.test(s);

    const price = lines.find(isPrice) || null;
    const location = [...lines].reverse().find(isLocation) || null;
    const title = lines.find((l) => !isPrice(l) && !isBadge(l) && !isLocation(l)) || "";
    if (!title || title.length < 3) return;

    // The evaluator reads raw_text, so fold price and location into it —
    // otherwise a listing is just a bare title with no context to score.
    const raw_text = [title, price ? `Price: ${price}` : null, location ? `Location: ${location}` : null]
      .filter(Boolean)
      .join(" — ");

    results.push({
      post_id: `fbmp_${id}`,
      post_url: `https://www.facebook.com/marketplace/item/${id}`,
      // Marketplace hides the seller on the search grid; it's only on the
      // listing page. Claiming a name we didn't read would be worse than
      // being honest that we don't have one yet.
      author_name: "Marketplace seller",
      author_profile_url: null,
      timestamp: null,
      raw_text,
    });
  });

  return results;
}

function extractXPosts(groupUrl: string): RawExtractedPost[] {
  const results: RawExtractedPost[] = [];
  const seenTexts = new Set<string>();
  const postContainers = document.querySelectorAll('article[data-testid="tweet"]');

  const hashText = (str: string): string => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  };

  postContainers.forEach((container) => {
    const textElement = container.querySelector('div[data-testid="tweetText"]');
    const raw_text = textElement ? (textElement.textContent || "").trim() : "";
    if (!raw_text || raw_text.length <= 15) return;

    const textKey = raw_text.slice(0, 160).toLowerCase().replace(/\s+/g, " ");
    if (seenTexts.has(textKey)) return;
    seenTexts.add(textKey);

    const nameBlock = container.querySelector('div[data-testid="User-Name"]');
    const handleAnchor = nameBlock?.querySelector('a[href^="/"]') || null;
    const author_profile_url = handleAnchor
      ? window.location.origin + handleAnchor.getAttribute("href")
      : null;
    const author_name = nameBlock ? (nameBlock.textContent || "").trim().slice(0, 80) : "X user";

    const statusAnchor = container.querySelector('a[href*="/status/"]');
    const timeEl = container.querySelector("time[datetime]");
    let directUrl: string | null = null;
    if (statusAnchor) {
      const href = statusAnchor.getAttribute("href") || "";
      directUrl = (href.startsWith("http") ? href : window.location.origin + href).split("?")[0];
    }

    results.push({
      post_id: directUrl ? `x_${directUrl.replace(/[^a-zA-Z0-9]/g, "_")}` : `x_txt_${hashText(textKey)}`,
      post_url: directUrl || groupUrl,
      author_name,
      author_profile_url,
      timestamp: timeEl ? timeEl.getAttribute("datetime") : null,
      raw_text,
    });
  });

  return results;
}

export interface ScrapeSummary {
  posts: ScrapedPost[];
  log: string[];
  scrapedGroupIds: string[];
  /**
   * Sources that served a join prompt where the feed should have been.
   *
   * Reported separately from an empty scrape because the two look identical
   * from the outside and need opposite responses: an empty group is fine and
   * will fill up on its own, while this one can never collect anything until
   * the connected account joins it. Callers persist it so the UI can say so
   * instead of showing a healthy-looking source with zero posts forever.
   */
  joinWalledGroupIds: string[];
  /**
   * Platforms where every source came back empty in a way that points at our
   * code rather than at the feed — see `diagnosePlatform`. Callers should treat
   * these as an alert, not as a quiet week.
   */
  brokenPlatforms: string[];
}

interface PlatformScrapeResult {
  posts: ScrapedPost[];
  log: string[];
  scrapedGroupIds: string[];
  /**
   * Sources that served a join prompt where the feed should have been.
   *
   * Reported separately from an empty scrape because the two look identical
   * from the outside and need opposite responses: an empty group is fine and
   * will fill up on its own, while this one can never collect anything until
   * the connected account joins it. Callers persist it so the UI can say so
   * instead of showing a healthy-looking source with zero posts forever.
   */
  joinWalledGroupIds: string[];
  brokenPlatforms: string[];
}

/**
 * The top-level container selector each extractor above starts from.
 *
 * This deliberately duplicates the first `querySelectorAll` in each extractor,
 * because extractors are shipped into the page by `page.evaluate` and cannot
 * close over anything in this module — they have to be self-contained. Probing
 * with the same string separately is what lets us tell the two failure modes
 * apart: zero containers means the outer selector died, while containers with
 * zero extracted posts means the inner ones did. Keep in sync by hand; the
 * canary reports a mismatch as a broken platform either way, so drift here
 * degrades to a false alarm rather than to silence.
 */
const CONTAINER_SELECTORS: Record<string, string> = {
  facebook: 'div[role="feed"] > div, div[role="article"]',
  linkedin: "div.feed-shared-update-v2, div.search-content__result",
  nextdoor: "div.post",
  twitter: 'article[data-testid="tweet"]',
  marketplace: 'a[href*="/marketplace/item/"]',
};

/** What a single group's scrape actually did, for the canary to reason over. */
export interface GroupOutcome {
  name: string;
  /** Post containers the page exposed. -1 when the probe itself failed. */
  containers: number;
  /** Posts the DOM extractor produced, on its own. */
  extracted: number;
  /** Posts recovered from captured feed JSON that the DOM pass didn't find. */
  capturedOnly: number;
  /** True when the group is simply one we haven't joined — not a code failure. */
  behindJoinWall: boolean;
  /** True when the page bounced us to a login/checkpoint screen. */
  loggedOut: boolean;
  extractionError: string | null;
}

/**
 * Decides whether a platform's empty run means "nobody posted" or "our
 * selectors stopped matching", and says which.
 *
 * This is the failure this scraper was worst at: hardcoded class names like
 * `div.feed-shared-update-v2` get renamed on the platform's schedule, every
 * extraction round then throws or returns nothing, the per-round `catch` used
 * to swallow it, and every source reported "found 0 post(s)" — indistinguishable
 * from a genuinely quiet week. A source could sit dead for months with no
 * reason to suspect it.
 */
export function diagnosePlatform(platform: string, outcomes: GroupOutcome[]): string | null {
  const relevant = outcomes.filter((o) => !o.behindJoinWall);
  if (relevant.length === 0) return null;
  // Any source producing posts through the DOM proves that extractor still
  // works; a different source being empty is then just an empty source.
  if (relevant.some((o) => o.extracted > 0)) return null;

  // The case the JSON capture layer exists for: the markup selectors have died,
  // but the feed's own payload is still yielding posts, so no leads were lost.
  // Report it anyway — it's a real regression, just not an urgent one, and the
  // fallback shouldn't be allowed to hide it until that path breaks too.
  const rescued = relevant.reduce((sum, o) => sum + o.capturedOnly, 0);
  if (rescued > 0) {
    return `⚠ ${platform}: the page markup changed and the DOM extractor found nothing — ${rescued} post(s) came through the captured feed JSON instead, so nothing was lost. Update the selectors in lib/scraper.ts when convenient.`;
  }

  if (relevant.some((o) => o.loggedOut)) {
    return `⚠ ${platform}: signed out — reconnect the account in Settings, nothing was collected.`;
  }

  const errored = relevant.find((o) => o.extractionError);
  if (errored) {
    return `⚠ ${platform} extraction is broken — every source returned 0 posts and the page threw "${errored.extractionError}". The selectors in lib/scraper.ts probably need updating.`;
  }

  const withContainers = relevant.filter((o) => o.containers > 0);
  if (withContainers.length > 0) {
    const total = withContainers.reduce((sum, o) => sum + o.containers, 0);
    return `⚠ ${platform} extraction is broken — the page showed ${total} post block(s) across ${relevant.length} source(s) but not one could be read. The inner selectors in lib/scraper.ts (text/author) have changed.`;
  }

  if (relevant.every((o) => o.containers === 0)) {
    return `⚠ ${platform} extraction is broken — 0 post blocks found on any of ${relevant.length} source(s). The container selector in lib/scraper.ts has changed, or these feeds aren't loading.`;
  }

  return null;
}

/**
 * Converts whatever URL shape "Add a Source" saved (a subreddit URL or a
 * /search/?q= URL) into its `.json` equivalent.
 *
 * This path used to be the cheapest source we had — append `.json` to any
 * listing URL and Reddit answered, no login, no browser, no session. That is
 * no longer true. Verified 2026-08-09: `www.reddit.com/r/<sub>/new.json`
 * returns 403 "You've been blocked by network security" for every header
 * combination tried (descriptive UA, full Chrome UA, no headers at all), on
 * old.reddit.com as well, and from inside a real headless Chromium too — so
 * it is not a User-Agent problem and escalating to the browser tier does not
 * fix it. Reddit now gates unauthenticated programmatic reads.
 *
 * The sanctioned fix is Reddit's OAuth API (register a script app, exchange
 * client credentials for a token, call oauth.reddit.com — free, and 100
 * requests/minute, far above what this needs). That needs a credential the
 * operator has to create, so it is left as a decision rather than guessed at
 * here; until then this source reports a clear reason instead of dying quietly.
 */
function toRedditJsonUrl(rawUrl: string): string {
  const u = new URL(rawUrl);
  const subredditMatch = u.pathname.match(/^\/r\/([A-Za-z0-9_]+)\/?$/);
  if (subredditMatch) {
    return `https://www.reddit.com/r/${subredditMatch[1]}/new.json?limit=25`;
  }
  if (u.pathname.startsWith("/search")) {
    const q = u.searchParams.get("q") ?? "";
    return `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&limit=25`;
  }
  return rawUrl.replace(/\/?$/, ".json");
}

async function scrapeRedditGroup(group: GroupToScrape, throttle: DomainThrottle): Promise<ScrapedPost[]> {
  const publicUrl = toRedditJsonUrl(group.url);

  // Anonymous reads are gone: www.reddit.com answers 403 and old.reddit.com
  // answers 200 with an HTML interstitial. Only an app-only bearer token gets
  // real listings back, so a missing credential is a setup problem to report,
  // not a request to attempt and let fail confusingly.
  const token = await getRedditToken();
  if (!token) {
    throw new Error(REDDIT_SETUP_HINT);
  }

  const jsonUrl = toOAuthUrl(publicUrl);
  // Reddit throttles generic user agents harder, so this one header overrides
  // the generic browser set.
  const res = await fetchPaced(jsonUrl, throttle, {
    headers: {
      "User-Agent": REDDIT_USER_AGENT,
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.verdict !== "ok") {
    // Say which kind of failure it was — "rate limited, backing off", "Reddit
    // has closed this door for good" and "that subreddit is gone" need
    // completely different responses from whoever reads the log.
    const detail =
      res.verdict === "rate_limited"
        ? `rate limited (429) — pacing slowed to ${throttle.delayFor(jsonUrl)}ms for reddit.com, it should recover on the next run`
        : res.verdict === "blocked"
          ? `Reddit rejected the API credentials (${res.status}). Check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET — a retry won't fix this.`
          : (res.error ?? `HTTP ${res.status}`);
    throw new Error(`Reddit request failed: ${detail}`);
  }

  const data = JSON.parse(res.body);
  const children: unknown[] = data?.data?.children ?? [];

  const posts: ScrapedPost[] = [];
  for (const child of children) {
    const p = (child as { data?: Record<string, unknown> })?.data;
    if (!p) continue;
    const title = typeof p.title === "string" ? p.title : "";
    const selftext = typeof p.selftext === "string" ? p.selftext : "";
    const raw_text = [title, selftext].filter(Boolean).join("\n\n").slice(0, 1500);
    if (!raw_text || raw_text.length <= 15) continue;

    const id = typeof p.id === "string" ? p.id : String(p.id ?? Math.random());
    const permalink = typeof p.permalink === "string" ? p.permalink : null;
    const author = typeof p.author === "string" ? p.author : null;
    const createdUtc = typeof p.created_utc === "number" ? p.created_utc : null;

    posts.push({
      group_id: group.id,
      platform: "reddit",
      external_post_id: `reddit_${id}`,
      post_url: permalink ? `https://www.reddit.com${permalink}` : group.url,
      author_name: author || "Reddit user",
      author_profile_url: author ? `https://www.reddit.com/user/${author}/` : null,
      posted_at: createdUtc ? new Date(createdUtc * 1000).toISOString() : null,
      raw_text,
    });
  }
  return posts;
}

// Minimum scroll rounds every group gets regardless of what shows up — keeps
// early-exit (below) from cutting off a group that just needed a couple of
// scrolls before anything rendered.
const MIN_SCROLL_ROUNDS = 3;
const MAX_SCROLL_ROUNDS = 7;
// Two consecutive rounds that surface nothing new means the feed's caught up
// — no reason to keep scrolling and waiting out the remaining rounds.
const STALE_ROUNDS_TO_STOP = 2;

async function scrapeRedditPlatform(platformGroups: GroupToScrape[]): Promise<PlatformScrapeResult> {
  const log: string[] = [];
  const posts: ScrapedPost[] = [];
  const scrapedGroupIds: string[] = [];
  const joinWalledGroupIds: string[] = [];
  // One throttle for the whole Reddit pass, so each source's response informs
  // the pacing of the next instead of every source guessing independently.
  const throttle = new DomainThrottle();

  for (const group of platformGroups) {
    try {
      const groupPosts = await scrapeRedditGroup(group, throttle);
      log.push(`"${group.name}": found ${groupPosts.length} post(s).`);
      posts.push(...groupPosts);
      scrapedGroupIds.push(group.id);
    } catch (err) {
      log.push(`"${group.name}" failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    // No fixed sleep here any more — the throttle paces the next request from
    // how reddit.com actually responded, which is both faster when it's happy
    // and properly cautious when it isn't.
  }
  return { posts, log, scrapedGroupIds, joinWalledGroupIds, brokenPlatforms: [] };
}

async function scrapeBrowserPlatform(
  platform: string,
  platformGroups: GroupToScrape[],
  userId: string,
  /**
   * Absolute time this crawl must be finished by, or null for no limit.
   *
   * Shared across every platform in the run rather than per-platform: the
   * constraint being respected is one serverless invocation's 60 seconds, and
   * two platforms each granted their own 40 would blow it between them.
   */
  runDeadline: number | null = null
): Promise<PlatformScrapeResult> {
  const log: string[] = [];
  const posts: ScrapedPost[] = [];
  const scrapedGroupIds: string[] = [];
  const joinWalledGroupIds: string[] = [];
  const outcomes: GroupOutcome[] = [];

  // Chosen per group, not per bucket: Marketplace rides inside the Facebook
  // bucket (it shares that login), so one bucket can hold two source types.
  const extractorFor = (p: string) =>
    p === "facebook"
      ? extractFacebookPosts
      : p === "linkedin"
        ? extractLinkedInPosts
        : p === "nextdoor"
          ? extractNextdoorPosts
          : p === "twitter"
            ? extractXPosts
            : p === "marketplace"
              ? extractMarketplaceListings
              : null;

  if (!platformGroups.some((g) => extractorFor(g.platform))) {
    for (const group of platformGroups) {
      log.push(`Skipped "${group.name}" — ${group.platform} scraping isn't supported yet.`);
    }
    return { posts, log, scrapedGroupIds, joinWalledGroupIds, brokenPlatforms: [] };
  }

  // Where this customer's login lives — a stored storageState blob usable from
  // any machine, or a Chrome profile on this one — is openPlatformContext's
  // problem, not this function's. See lib/browser-context.ts.
  let opened;
  try {
    opened = await openPlatformContext(userId, platform);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    for (const group of platformGroups) {
      log.push(`"${group.name}" failed: ${formatAuthLaunchError(message, platform)}`);
    }
    return { posts, log, scrapedGroupIds, joinWalledGroupIds, brokenPlatforms: [] };
  }

  if (!opened) {
    // No session anywhere. Say so plainly instead of launching a browser that
    // would read the signed-out wall and report an empty group as scraped.
    for (const group of platformGroups) {
      log.push(
        `"${group.name}" skipped — no connected ${platform} session for this account.`
      );
    }
    return { posts, log, scrapedGroupIds, joinWalledGroupIds, brokenPlatforms: [] };
  }

  const context = opened.context;

  /**
   * A wall-clock budget on the crawl — but only when the browser is rented.
   *
   * Two limits bite at once on the hosted deployment and neither exists
   * locally. The serverless function is capped at 60 seconds, and a rented
   * browser bills by the minute. A Facebook group takes 20-40 seconds to crawl
   * at human pace, so a customer with ten groups cannot be crawled in one
   * invocation no matter how it is written.
   *
   * Being killed mid-loop is the bad ending: `release()` in the finally below
   * never runs, so the rented browser keeps billing until the provider's own
   * idle timeout. Stopping early is the good one — the groups that were read
   * are saved, the browser is closed properly, and the rest are picked up by
   * the next run. Groups arrive stalest-first, so successive runs rotate
   * through them rather than re-reading the same first few.
   *
   * Locally there is no function timeout and no per-minute bill, so the whole
   * list is crawled in one pass exactly as before.
   */
  const deadline = opened.source === "cloud" ? runDeadline : null;
  let processed = 0;
  let stoppedEarly = false;

  /**
   * How much time a group needs, so the check below can stop *before* starting
   * one it cannot finish.
   *
   * Checking "am I past the deadline?" was not enough, and the failure was the
   * one the budget existed to prevent. A group takes 15-30 seconds; starting
   * one with 3 seconds left runs 27 seconds past the deadline and straight
   * into the platform's hard kill, so `release()` never ran and the customer
   * got a 504 that reads as "the app is broken" rather than a partial result.
   *
   * The floor is a starting guess; after the first group the real measured
   * time replaces it, so a slow account reserves more and a fast one less.
   */
  const PER_GROUP_FLOOR_MS = 20_000;
  let slowestGroupMs = 0;

  try {
    const page = await context.newPage();

    // Defensive shim: when this module runs through esbuild-based tooling
    // (e.g. `tsx`, used by the standalone local auto-scrape script) instead
    // of Next.js's own SWC pipeline, esbuild's `keepNames` transform injects
    // `__name(fn, "fn")` calls around nested const-arrow helpers (like
    // getMessage/parseRelativeAge inside each extractor). That injected call
    // ends up baked into the extractor function's own source text, so when
    // Playwright ships that source into the page via page.evaluate(), it
    // throws "__name is not defined" in the page's isolated context — every
    // extraction round fails silently (caught below) and every group comes
    // back with 0 posts, with no visible error. Next.js/SWC never does this,
    // so this is a no-op there; it only matters for tsx-run entry points.
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__name ??= (fn: unknown) => fn;
    });

    for (const group of platformGroups) {
      if (deadline !== null && Date.now() + Math.max(PER_GROUP_FLOOR_MS, slowestGroupMs) > deadline) {
        stoppedEarly = true;
        break;
      }
      const groupStartedAt = Date.now();
      processed++;
      const extractor = extractorFor(group.platform);
      if (!extractor) {
        log.push(`Skipped "${group.name}" — ${group.platform} scraping isn't supported yet.`);
        continue;
      }
      const outcome: GroupOutcome = {
        name: group.name,
        containers: -1,
        extracted: 0,
        capturedOnly: 0,
        behindJoinWall: false,
        loggedOut: false,
        extractionError: null,
      };
      outcomes.push(outcome);

      // Start recording the feed's own JSON before navigating, so the first
      // payload — which arrives with the initial page load — isn't missed.
      const capture = attachFeedCapture(page, group.platform);

      try {
        await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(4000);

        // A bounce to login/checkpoint explains an empty run completely, and
        // needs a different fix (reconnect the account) than a dead selector.
        const landedOn = page.url();
        outcome.loggedOut = /\/(login|checkpoint|authwall|uas\/login)/i.test(landedOn);

        const collected = new Map<string, RawExtractedPost>();
        let staleRounds = 0;

        for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
          if (round > 0) {
            await page.mouse.wheel(0, randBetween(1100, 1700));
            await page.waitForTimeout(randBetween(1400, 2400));
          }
          const sizeBefore = collected.size;
          try {
            const batch = await page.evaluate(extractor, group.url);
            for (const p of batch) {
              if (!collected.has(p.post_id)) collected.set(p.post_id, p);
            }
          } catch (err) {
            // A single round failing still shouldn't abort the group — but it
            // must not vanish either. This used to be an empty catch, which is
            // exactly how a broken extractor stayed invisible: every round
            // threw, every group reported 0 posts, and nothing said why.
            outcome.extractionError = err instanceof Error ? err.message : "unknown error";
          }

          if (round + 1 < MIN_SCROLL_ROUNDS) continue;
          staleRounds = collected.size === sizeBefore ? staleRounds + 1 : 0;
          if (staleRounds >= STALE_ROUNDS_TO_STOP) break;
        }

        // Count what the page actually offered, so an empty result can be
        // attributed to the outer selector, the inner ones, or a real lull.
        const containerSelector = CONTAINER_SELECTORS[group.platform];
        if (containerSelector) {
          outcome.containers = await page
            .evaluate((sel: string) => document.querySelectorAll(sel).length, containerSelector)
            .catch(() => -1);
        }

        // Fold in anything the feed's own JSON carried that the DOM pass
        // didn't produce. DOM results are inserted first and never overwritten,
        // so this can only add. Two things make it worth the trouble: the
        // feeds are virtualized, so a post scrolled past is gone from the DOM
        // but still present in the payload that delivered it; and on the day a
        // class name changes, this is the path that keeps returning posts.
        await capture.settle();
        // Recorded before merging, so the canary can still tell that the DOM
        // path died even on a run where capture quietly covered for it.
        outcome.extracted = collected.size;
        let capturedOnly = 0;
        for (const captured of capture.drain()) {
          if (collected.has(captured.post_id)) continue;
          collected.set(captured.post_id, {
            post_id: captured.post_id,
            post_url: captured.post_url ?? group.url,
            author_name: captured.author_name,
            author_profile_url: captured.author_profile_url,
            timestamp: captured.timestamp,
            raw_text: captured.raw_text,
          });
          capturedOnly++;
        }
        outcome.capturedOnly = capturedOnly;
        if (capturedOnly > 0) {
          const { responses } = capture.stats();
          log.push(
            `"${group.name}": +${capturedOnly} post(s) recovered from ${responses} captured feed response(s) that the page markup didn't show.`
          );
        }

        const groupPosts = [...collected.values()];

        // A group you haven't joined does not error. Facebook and LinkedIn
        // both serve a perfectly valid page with a join prompt where the feed
        // would be, so extraction finds nothing and this reported "found 0
        // post(s)" — which reads exactly like a group where nobody happened to
        // need a plumber this week. A mis-tracked source could sit there
        // collecting nothing for weeks with no reason to suspect it. Check for
        // the join wall before accepting zero as an answer.
        if (groupPosts.length === 0) {
          const behindJoinWall = await page
            .getByRole("button", { name: /^(join group|join community|request to join)$/i })
            .count()
            .catch(() => 0);
          if (behindJoinWall > 0) {
            outcome.behindJoinWall = true;
            // Reported upward so the caller can persist it. The run log says
            // this too, but nobody reads a run log — the Communities page is
            // where someone goes to ask why a source is quiet, and it needs to
            // be able to answer.
            joinWalledGroupIds.push(group.id);
            log.push(
              `"${group.name}": you're not a member yet — join it on ${platform}, then it will start collecting.`
            );
            // Deliberately left out of scrapedGroupIds: last_scraped_at is the
            // heartbeat the UI shows as "working", and nothing was read here.
            continue;
          }
        }

        log.push(`"${group.name}": found ${groupPosts.length} post(s).`);
        scrapedGroupIds.push(group.id);

        for (const p of groupPosts) {
          posts.push({
            group_id: group.id,
            platform: group.platform,
            external_post_id: p.post_id,
            post_url: p.post_url,
            author_name: p.author_name,
            author_profile_url: p.author_profile_url,
            posted_at: p.timestamp,
            raw_text: p.raw_text,
          });
        }
      } catch (err) {
        log.push(`"${group.name}" failed: ${err instanceof Error ? err.message : "unknown error"}`);
      } finally {
        // Detach per group. The page is reused across every group on this
        // platform, so leaving listeners attached would stack one per group
        // and hold every captured body in memory until the browser closed.
        capture.stop();
      }

      // Polite randomized pause between groups — keeps the crawl human-paced.
      await sleep(randBetween(2000, 5000));

      // Measured including the pause, because that is time the next group also
      // has to fit inside.
      slowestGroupMs = Math.max(slowestGroupMs, Date.now() - groupStartedAt);
    }
  } finally {
    // release(), not context.close(): for a stored session this also writes
    // the refreshed cookies back, which is what keeps the connection alive
    // past the platform's rotation window.
    await opened.release();
  }

  if (stoppedEarly) {
    const remaining = platformGroups.length - processed;
    log.push(
      `Stopped after ${processed} of ${platformGroups.length} ${platform} source(s) to stay inside the time limit — the other ${remaining} are next in line and will be read on the next run.`
    );
  }

  // One verdict for the whole platform, after every source has been seen. A
  // single empty group proves nothing; every group on a platform coming back
  // empty is a code problem until shown otherwise.
  const brokenPlatforms: string[] = [];
  const diagnosis = diagnosePlatform(platform, outcomes);
  if (diagnosis) {
    log.unshift(diagnosis);
    brokenPlatforms.push(platform);
  }

  return { posts, log, scrapedGroupIds, joinWalledGroupIds, brokenPlatforms };
}

/**
 * Crawls each active group's feed with a persistent, human-paced scroll,
 * re-extracting after every scroll step since Facebook/LinkedIn virtualize
 * their feeds (posts scrolled past disappear from the DOM).
 */
export async function scrapeActiveGroups(
  groups: GroupToScrape[],
  userId: string,
  /** Wall-clock budget for rented browsers. See scrapeAndStorePosts. */
  budgetMs = 45_000
): Promise<ScrapeSummary> {
  // One persistent-context browser per platform, not one shared across all
  // of them — Chromium only lets one process hold a given profile directory
  // at a time, so a single browser reused across Facebook/LinkedIn/Nextdoor/X
  // groups meant any one platform's Connect popup left open elsewhere could
  // block scraping every other platform too. That same isolation also makes
  // it safe to run every platform concurrently below: each one paces itself
  // against its own account, so scraping Facebook and LinkedIn at the same
  // time doesn't make either look more automated than scraping them one
  // after another already does — it just stops one from idling while the
  // other finishes.
  // Bucket by *session*, not by source type. Marketplace is part of Facebook
  // and uses the same login, so it must share Facebook's profile directory —
  // giving it its own bucket would run two Chromium processes against the same
  // profile concurrently, which Chromium refuses, breaking both.
  const groupsByPlatform = new Map<string, GroupToScrape[]>();
  for (const group of groups) {
    const sessionKey = sessionPlatform(group.platform);
    const list = groupsByPlatform.get(sessionKey) ?? [];
    list.push(group);
    groupsByPlatform.set(sessionKey, list);
  }

  /**
   * On the hosted deployment every browser is rented, and that changes both
   * limits this schedule has to respect.
   *
   * Concurrency: locally, running Facebook and LinkedIn at once costs nothing
   * — they are separate Chrome processes on an idle machine. A provider sells
   * concurrent browsers by the seat, and exceeding the plan's allowance is
   * refused outright, which would show up as one platform collecting and
   * another mysteriously failing every run. Sequential is slower and always
   * works.
   *
   * Time: the whole run shares one 45-second budget, because what it is
   * really sharing is one 60-second serverless invocation. Whatever the budget
   * doesn't reach is read on the next run, stalest first.
   *
   * Reddit is exempt from both — no browser, just HTTP — so it stays parallel
   * with the browser pass and never eats into its time.
   */
  const rented = isHostedDeployment();
  const runDeadline = rented ? Date.now() + budgetMs : null;

  const buckets = [...groupsByPlatform.entries()];
  const redditBuckets = buckets.filter(([platform]) => platform === "reddit");
  const browserBuckets = buckets.filter(([platform]) => platform !== "reddit");

  const runBrowserBuckets = async (): Promise<PlatformScrapeResult[]> => {
    if (!rented) {
      return Promise.all(
        browserBuckets.map(([platform, platformGroups]) =>
          scrapeBrowserPlatform(platform, platformGroups, userId, runDeadline)
        )
      );
    }
    const results: PlatformScrapeResult[] = [];
    for (const [platform, platformGroups] of browserBuckets) {
      results.push(await scrapeBrowserPlatform(platform, platformGroups, userId, runDeadline));
    }
    return results;
  };

  const [redditResults, browserResults] = await Promise.all([
    Promise.all(redditBuckets.map(([, platformGroups]) => scrapeRedditPlatform(platformGroups))),
    runBrowserBuckets(),
  ]);
  const platformResults = [...redditResults, ...browserResults];

  const posts: ScrapedPost[] = [];
  const log: string[] = [];
  const scrapedGroupIds: string[] = [];
  const joinWalledGroupIds: string[] = [];
  const brokenPlatforms: string[] = [];
  for (const result of platformResults) {
    posts.push(...result.posts);
    log.push(...result.log);
    scrapedGroupIds.push(...result.scrapedGroupIds);
    joinWalledGroupIds.push(...result.joinWalledGroupIds);
    brokenPlatforms.push(...result.brokenPlatforms);
  }

  return { posts, log, scrapedGroupIds, joinWalledGroupIds, brokenPlatforms };
}
