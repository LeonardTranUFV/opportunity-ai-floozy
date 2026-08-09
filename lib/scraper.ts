import { getChromium } from "@/lib/browser";
import { getAuthSessionPath, formatAuthLaunchError } from "@/lib/auth-session";

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
}

interface PlatformScrapeResult {
  posts: ScrapedPost[];
  log: string[];
  scrapedGroupIds: string[];
}

/**
 * Reddit's public JSON API (append .json to any listing/search URL) is free
 * and unauthenticated for reading — no login, no browser, no persistent
 * session needed at all. Converts whatever URL shape "Add a Source" saved
 * (a subreddit URL or a /search/?q= URL) into its .json equivalent.
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

async function scrapeRedditGroup(group: GroupToScrape): Promise<ScrapedPost[]> {
  const jsonUrl = toRedditJsonUrl(group.url);
  // Reddit rate-limits/blocks requests without a descriptive User-Agent.
  const res = await fetch(jsonUrl, {
    headers: { "User-Agent": "OpportunityAI/1.0 (lead-discovery bot; contact: app admin)" },
  });
  if (!res.ok) {
    throw new Error(`Reddit request failed (${res.status})`);
  }
  const data = await res.json();
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
  for (const group of platformGroups) {
    try {
      const groupPosts = await scrapeRedditGroup(group);
      log.push(`"${group.name}": found ${groupPosts.length} post(s).`);
      posts.push(...groupPosts);
      scrapedGroupIds.push(group.id);
    } catch (err) {
      log.push(`"${group.name}" failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    await sleep(randBetween(500, 1200));
  }
  return { posts, log, scrapedGroupIds };
}

async function scrapeBrowserPlatform(
  platform: string,
  platformGroups: GroupToScrape[],
  userId: string
): Promise<PlatformScrapeResult> {
  const log: string[] = [];
  const posts: ScrapedPost[] = [];
  const scrapedGroupIds: string[] = [];

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
    return { posts, log, scrapedGroupIds };
  }

  let context;
  try {
    const chromium = await getChromium();
    context = await chromium.launchPersistentContext(getAuthSessionPath(userId, platform), {
      headless: true,
      channel: "chrome",
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    for (const group of platformGroups) {
      log.push(`"${group.name}" failed: ${formatAuthLaunchError(message, platform)}`);
    }
    return { posts, log, scrapedGroupIds };
  }

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
      const extractor = extractorFor(group.platform);
      if (!extractor) {
        log.push(`Skipped "${group.name}" — ${group.platform} scraping isn't supported yet.`);
        continue;
      }
      try {
        await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(4000);

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
          } catch {
            // a single extraction round failing shouldn't abort the whole group
          }

          if (round + 1 < MIN_SCROLL_ROUNDS) continue;
          staleRounds = collected.size === sizeBefore ? staleRounds + 1 : 0;
          if (staleRounds >= STALE_ROUNDS_TO_STOP) break;
        }

        const groupPosts = [...collected.values()];
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
      }

      // Polite randomized pause between groups — keeps the crawl human-paced.
      await sleep(randBetween(2000, 5000));
    }
  } finally {
    await context.close();
  }

  return { posts, log, scrapedGroupIds };
}

/**
 * Crawls each active group's feed with a persistent, human-paced scroll,
 * re-extracting after every scroll step since Facebook/LinkedIn virtualize
 * their feeds (posts scrolled past disappear from the DOM).
 */
export async function scrapeActiveGroups(groups: GroupToScrape[], userId: string): Promise<ScrapeSummary> {
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

  const platformResults = await Promise.all(
    [...groupsByPlatform.entries()].map(([platform, platformGroups]) =>
      platform === "reddit"
        ? scrapeRedditPlatform(platformGroups)
        : scrapeBrowserPlatform(platform, platformGroups, userId)
    )
  );

  const posts: ScrapedPost[] = [];
  const log: string[] = [];
  const scrapedGroupIds: string[] = [];
  for (const result of platformResults) {
    posts.push(...result.posts);
    log.push(...result.log);
    scrapedGroupIds.push(...result.scrapedGroupIds);
  }

  return { posts, log, scrapedGroupIds };
}
