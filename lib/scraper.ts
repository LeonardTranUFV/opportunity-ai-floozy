import { chromium } from "playwright";
import { getAuthSessionPath } from "@/lib/auth-session";

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

export interface ScrapeSummary {
  posts: ScrapedPost[];
  log: string[];
}

/**
 * Crawls each active group's feed with a persistent, human-paced scroll,
 * re-extracting after every scroll step since Facebook/LinkedIn virtualize
 * their feeds (posts scrolled past disappear from the DOM).
 */
export async function scrapeActiveGroups(groups: GroupToScrape[], userId: string): Promise<ScrapeSummary> {
  const log: string[] = [];
  const posts: ScrapedPost[] = [];

  const context = await chromium.launchPersistentContext(getAuthSessionPath(userId), {
    headless: true,
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  try {
    const page = await context.newPage();

    for (const group of groups) {
      if (group.platform !== "facebook" && group.platform !== "linkedin") {
        log.push(`Skipped "${group.name}" — ${group.platform} scraping isn't supported yet.`);
        continue;
      }

      try {
        await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(4000);

        const collected = new Map<string, RawExtractedPost>();
        const extractor = group.platform === "facebook" ? extractFacebookPosts : extractLinkedInPosts;

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

  return { posts, log };
}
