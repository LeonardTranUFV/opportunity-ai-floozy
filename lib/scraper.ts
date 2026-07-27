import { chromium } from "playwright";
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
    const author_profile_url = authorElement ? authorElement.getAttribute("href") : null;

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
    const author_profile_url =
      container.querySelector("a.feed-shared-actor__image-link")?.getAttribute("href") || null;

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
function extractNextdoorPosts(groupUrl: string): RawExtractedPost[] {
  const results: RawExtractedPost[] = [];
  const seenTexts = new Set<string>();
  const postContainers = document.querySelectorAll(
    'article, div[data-testid="post"], div[data-testid="realtime-feed-post"]'
  );

  const hashText = (str: string): string => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  };

  const getMessage = (container: Element): string => {
    let best = "";
    container.querySelectorAll('p, span, div[dir="auto"]').forEach((el) => {
      const t = (el.textContent || "").trim();
      if (t.length > best.length) best = t;
    });
    return best;
  };

  postContainers.forEach((container) => {
    if ((container.textContent || "").trim().length < 30) return;

    const authorElement = container.querySelector('a[href*="/profile/"], h2 a, h3 a');
    const raw_text = getMessage(container).slice(0, 1500);
    const author_name = authorElement ? (authorElement.textContent || "").trim() : "Neighbor";
    const author_profile_url = authorElement ? authorElement.getAttribute("href") : null;

    if (!raw_text || raw_text.length <= 20) return;

    const textKey = raw_text.slice(0, 160).toLowerCase().replace(/\s+/g, " ");
    if (seenTexts.has(textKey)) return;
    seenTexts.add(textKey);

    let directUrl: string | null = null;
    const permalinkAnchor = container.querySelector('a[href*="/p/"]');
    if (permalinkAnchor) {
      const href = permalinkAnchor.getAttribute("href") || "";
      directUrl = (href.startsWith("http") ? href : window.location.origin + href).split("?")[0];
    }

    const timeEl = container.querySelector("time[datetime]");
    const timestamp = timeEl ? timeEl.getAttribute("datetime") : null;

    results.push({
      post_id: directUrl ? `nd_${directUrl.replace(/[^a-zA-Z0-9]/g, "_")}` : `nd_txt_${hashText(textKey)}`,
      post_url: directUrl || groupUrl,
      author_name,
      author_profile_url,
      timestamp,
      raw_text,
    });
  });

  return results;
}

/** X (Twitter) search-results timeline — `data-testid` hooks are the stable, documented markers X itself uses for automated testing, so these are lower-risk than the Nextdoor guesses above. Still unverified live. */
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

/**
 * Crawls each active group's feed with a persistent, human-paced scroll,
 * re-extracting after every scroll step since Facebook/LinkedIn virtualize
 * their feeds (posts scrolled past disappear from the DOM).
 */
export async function scrapeActiveGroups(groups: GroupToScrape[], userId: string): Promise<ScrapeSummary> {
  const log: string[] = [];
  const posts: ScrapedPost[] = [];

  // One persistent-context browser per platform, not one shared across all
  // of them — Chromium only lets one process hold a given profile directory
  // at a time, so a single browser reused across Facebook/LinkedIn/Nextdoor/X
  // groups meant any one platform's Connect popup left open elsewhere could
  // block scraping every other platform too.
  const groupsByPlatform = new Map<string, GroupToScrape[]>();
  for (const group of groups) {
    const list = groupsByPlatform.get(group.platform) ?? [];
    list.push(group);
    groupsByPlatform.set(group.platform, list);
  }

  for (const [platform, platformGroups] of groupsByPlatform) {
    // Reddit is a plain HTTP fetch against its public JSON API — no browser,
    // no persistent session, so it's handled entirely separately from the
    // Playwright-based platforms below.
    if (platform === "reddit") {
      for (const group of platformGroups) {
        try {
          const groupPosts = await scrapeRedditGroup(group);
          log.push(`"${group.name}": found ${groupPosts.length} post(s).`);
          posts.push(...groupPosts);
        } catch (err) {
          log.push(`"${group.name}" failed: ${err instanceof Error ? err.message : "unknown error"}`);
        }
        await sleep(randBetween(500, 1200));
      }
      continue;
    }

    const extractor =
      platform === "facebook"
        ? extractFacebookPosts
        : platform === "linkedin"
          ? extractLinkedInPosts
          : platform === "nextdoor"
            ? extractNextdoorPosts
            : platform === "twitter"
              ? extractXPosts
              : null;

    if (!extractor) {
      for (const group of platformGroups) {
        log.push(`Skipped "${group.name}" — ${platform} scraping isn't supported yet.`);
      }
      continue;
    }

    let context;
    try {
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
      continue;
    }

    try {
      const page = await context.newPage();

      for (const group of platformGroups) {
        try {
          await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(4000);

          const collected = new Map<string, RawExtractedPost>();

          for (let round = 0; round < 7; round++) {
            if (round > 0) {
              await page.mouse.wheel(0, randBetween(1100, 1700));
              await page.waitForTimeout(randBetween(1400, 2400));
            }
            try {
              const batch = await page.evaluate(extractor, group.url);
              for (const p of batch) {
                if (!collected.has(p.post_id)) collected.set(p.post_id, p);
              }
            } catch {
              // a single extraction round failing shouldn't abort the whole group
            }
          }

          const groupPosts = [...collected.values()];
          log.push(`"${group.name}": found ${groupPosts.length} post(s).`);

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
  }

  return { posts, log };
}
