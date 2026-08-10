import type { Page, Response } from "playwright";

/**
 * Reads posts out of the JSON each feed fetches for itself, instead of out of
 * the rendered DOM.
 *
 * Every extractor in lib/scraper.ts is a list of hand-written CSS class names
 * (`div.feed-shared-update-v2`, `span.break-words`, …). Those are build
 * artifacts of the platform's frontend — they get renamed on the platform's
 * schedule, without notice, and when they do the scraper goes quiet rather
 * than loud. The JSON underneath is a different story: it's the contract the
 * platform's own app depends on, so its field names change far more slowly
 * than the markup wrapped around them.
 *
 * This runs alongside DOM extraction rather than replacing it. DOM stays
 * primary because it is verified against real sessions; capture fills in what
 * the DOM missed and, more importantly, keeps producing posts on the day a
 * class name changes. Everything here is wrapped so that a shape we don't
 * recognise yields nothing at all — it can add posts, never remove or corrupt
 * them.
 *
 * NOT YET VERIFIED against live logged-in sessions for any platform. The
 * shapes below are read from each platform's documented/observable API
 * conventions, in the same spirit as the original Nextdoor selectors. Until a
 * real run confirms them, treat a zero capture count as expected and the DOM
 * path as the one doing the work.
 */

export interface CapturedPost {
  post_id: string;
  post_url: string | null;
  author_name: string;
  author_profile_url: string | null;
  timestamp: string | null;
  raw_text: string;
}

/** URL fragments identifying the request that carries feed data, per platform. */
const FEED_ENDPOINTS: Record<string, RegExp> = {
  facebook: /\/api\/graphql\/?$/,
  marketplace: /\/api\/graphql\/?$/,
  linkedin: /\/voyager\/api\//,
  twitter: /\/i\/api\/graphql\//,
  nextdoor: /\/api\/|\/gql/,
};

// Ceilings so a long scroll can't grow unboundedly in memory. A feed page
// issues a handful of sizeable JSON responses per scroll; these are generous
// for seven scroll rounds and still bounded.
const MAX_CAPTURED_RESPONSES = 120;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_NODES_WALKED = 250_000;

const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 1500;

function hashText(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Facebook and X both serve GraphQL responses that aren't a single JSON
 * document: Facebook streams newline-delimited objects, and both may prefix
 * the body with an anti-JSON-hijacking guard (`for (;;);`). Parse defensively
 * and keep whatever parses.
 */
function parseJsonDocuments(body: string): unknown[] {
  const cleaned = body.replace(/^\s*(for\s*\(;;\);|\)\]\}',?)\s*/, "");
  const documents: unknown[] = [];

  try {
    documents.push(JSON.parse(cleaned));
    return documents;
  } catch {
    // Not a single document — fall through to line-delimited parsing.
  }

  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) continue;
    try {
      documents.push(JSON.parse(trimmed));
    } catch {
      // Partial chunk from a streamed response; skip it.
    }
  }
  return documents;
}

/** Walks a parsed document, handing every object to `visit`. Depth-bounded. */
function walk(root: unknown, visit: (node: Record<string, unknown>) => void): void {
  const stack: unknown[] = [root];
  let seen = 0;
  while (stack.length > 0 && seen < MAX_NODES_WALKED) {
    const node = stack.pop();
    if (!isObject(node)) continue;
    seen++;

    if (!Array.isArray(node)) visit(node);

    for (const value of Object.values(node)) {
      if (isObject(value)) stack.push(value);
    }
  }
}

type ShapeReader = (node: Record<string, unknown>) => CapturedPost | null;

/**
 * Facebook / Marketplace comet story nodes.
 *
 * The stable marker is a `message.text` string sitting beside `actors` and a
 * `wwwURL`. Sponsored and suggested content shares the shape, which is fine —
 * the AI scoring step is what decides relevance, exactly as it does for DOM
 * scraped posts.
 */
const readFacebookStory: ShapeReader = (node) => {
  const message = node.message;
  const text = isObject(message) ? str(message.text) : null;
  if (!text || text.length < MIN_TEXT_LENGTH) return null;

  const actors = Array.isArray(node.actors) ? node.actors : [];
  const actor = isObject(actors[0]) ? (actors[0] as Record<string, unknown>) : null;

  const url = str(node.wwwURL) ?? str(node.url);
  const postId = str(node.post_id) ?? str(node.id);
  const created = typeof node.creation_time === "number" ? node.creation_time : null;

  return {
    post_id: postId ? `fb_${postId}` : `fb_txt_${hashText(text.slice(0, 160).toLowerCase())}`,
    post_url: url,
    author_name: (actor && str(actor.name)) ?? "Anonymous Member",
    author_profile_url: actor ? (str(actor.url) ?? str(actor.profile_url)) : null,
    timestamp: created ? new Date(created * 1000).toISOString() : null,
    raw_text: text.slice(0, MAX_TEXT_LENGTH),
  };
};

/**
 * LinkedIn Voyager update objects: `commentary.text.text` is the post body,
 * `actor.name.text` the author, `entityUrn` the stable activity id.
 */
const readLinkedInUpdate: ShapeReader = (node) => {
  const commentary = node.commentary;
  const textNode = isObject(commentary) ? commentary.text : null;
  const text = isObject(textNode) ? str(textNode.text) : null;
  if (!text || text.length < MIN_TEXT_LENGTH) return null;

  const actor = isObject(node.actor) ? (node.actor as Record<string, unknown>) : null;
  const actorName = actor && isObject(actor.name) ? str((actor.name as Record<string, unknown>).text) : null;
  const nav = actor && isObject(actor.navigationContext) ? (actor.navigationContext as Record<string, unknown>) : null;

  const urn = str(node.entityUrn) ?? str(node.dashEntityUrn);
  const activityId = urn ? (urn.match(/urn:li:(?:activity|share):(\d+)/) ?? [])[1] : undefined;

  return {
    post_id: activityId
      ? `li_activity_${activityId}`
      : `li_txt_${hashText(text.slice(0, 160).toLowerCase())}`,
    post_url: activityId ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/` : null,
    author_name: actorName ?? "LinkedIn Professional",
    author_profile_url: nav ? str(nav.actionTarget) : null,
    timestamp: null,
    raw_text: text.slice(0, MAX_TEXT_LENGTH),
  };
};

/** X tweet results: the `legacy` block still carries full_text and created_at. */
const readXTweet: ShapeReader = (node) => {
  const legacy = isObject(node.legacy) ? (node.legacy as Record<string, unknown>) : null;
  if (!legacy) return null;
  const text = str(legacy.full_text) ?? str(legacy.text);
  if (!text || text.length < MIN_TEXT_LENGTH) return null;

  const idStr = str(legacy.id_str) ?? str(node.rest_id);
  const createdAt = str(legacy.created_at);

  // The author sits under core.user_results.result.legacy.screen_name.
  const core = isObject(node.core) ? (node.core as Record<string, unknown>) : null;
  const userResults = core && isObject(core.user_results) ? (core.user_results as Record<string, unknown>) : null;
  const userResult = userResults && isObject(userResults.result) ? (userResults.result as Record<string, unknown>) : null;
  const userLegacy = userResult && isObject(userResult.legacy) ? (userResult.legacy as Record<string, unknown>) : null;
  const screenName = userLegacy ? str(userLegacy.screen_name) : null;
  const displayName = userLegacy ? str(userLegacy.name) : null;

  const parsedDate = createdAt ? new Date(createdAt) : null;

  return {
    post_id: idStr ? `x_${idStr}` : `x_txt_${hashText(text.slice(0, 160).toLowerCase())}`,
    post_url: screenName && idStr ? `https://x.com/${screenName}/status/${idStr}` : null,
    author_name: displayName ?? screenName ?? "X user",
    author_profile_url: screenName ? `https://x.com/${screenName}` : null,
    timestamp: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
    raw_text: text.slice(0, MAX_TEXT_LENGTH),
  };
};

const SHAPE_READERS: Record<string, ShapeReader[]> = {
  facebook: [readFacebookStory],
  marketplace: [readFacebookStory],
  linkedin: [readLinkedInUpdate],
  twitter: [readXTweet],
  // Nextdoor's payload shape hasn't been observed; Facebook's story shape is a
  // reasonable first guess since neither is confirmed, and a miss costs
  // nothing because the DOM path is unaffected.
  nextdoor: [readFacebookStory],
};

/**
 * The whole parsing side, with no Playwright in it — given raw response bodies
 * and a platform, return the posts they contain. Split out from the capture
 * plumbing so the shape readers can be exercised against fixtures directly
 * instead of only through a live browser session.
 */
export function extractPostsFromBodies(
  bodies: string[],
  platform: string
): { posts: CapturedPost[]; errors: number } {
  const readers = SHAPE_READERS[platform] ?? [];
  const found = new Map<string, CapturedPost>();
  let errors = 0;

  for (const body of bodies) {
    let documents: unknown[];
    try {
      documents = parseJsonDocuments(body);
    } catch {
      errors++;
      continue;
    }
    for (const doc of documents) {
      try {
        walk(doc, (node) => {
          for (const read of readers) {
            let post: CapturedPost | null = null;
            try {
              post = read(node);
            } catch {
              errors++;
            }
            if (post && !found.has(post.post_id)) found.set(post.post_id, post);
          }
        });
      } catch {
        errors++;
      }
    }
  }

  return { posts: [...found.values()], errors };
}

export interface FeedCapture {
  /**
   * Waits for response bodies already in flight to land. Response events fire
   * before their body is readable, so draining without this races the last
   * scroll's payload — usually the one with the newest posts in it.
   */
  settle(): Promise<void>;
  /** Parse everything captured so far and return the posts found. */
  drain(): CapturedPost[];
  /** Stop listening. Safe to call more than once. */
  stop(): void;
  /** Diagnostics for the scrape log. */
  stats(): { responses: number; bytes: number; errors: number };
}

/**
 * Starts passively recording feed JSON on `page`. Never blocks, rewrites, or
 * delays a request — it only reads response bodies that the page fetched
 * anyway, so it cannot change how the session looks to the platform.
 */
export function attachFeedCapture(page: Page, platform: string): FeedCapture {
  const endpoint = FEED_ENDPOINTS[platform];
  const readers = SHAPE_READERS[platform] ?? [];

  const bodies: string[] = [];
  const pending: Promise<void>[] = [];
  let totalBytes = 0;
  let errors = 0;
  let stopped = false;

  const onResponse = (response: Response) => {
    if (stopped || !endpoint) return;
    if (bodies.length >= MAX_CAPTURED_RESPONSES || totalBytes >= MAX_TOTAL_BYTES) return;

    let url: string;
    try {
      url = response.url();
    } catch {
      return;
    }
    if (!endpoint.test(url)) return;

    // Reading the body is async and can reject (redirects, aborted requests,
    // navigation away mid-flight). Track the promise so drain() can await it,
    // and swallow failures — a body we can't read is simply one we don't have.
    pending.push(
      response
        .text()
        .then((text) => {
          if (stopped || !text) return;
          if (totalBytes + text.length > MAX_TOTAL_BYTES) return;
          totalBytes += text.length;
          bodies.push(text);
        })
        .catch(() => {
          errors++;
        })
    );
  };

  if (endpoint && readers.length > 0) {
    page.on("response", onResponse);
  }

  return {
    async settle(): Promise<void> {
      // Snapshot first: awaiting can let more responses arrive and push onto
      // `pending`, and awaiting a growing array on a live feed never returns.
      const inFlight = [...pending];
      await Promise.allSettled(inFlight);
    },
    drain(): CapturedPost[] {
      const result = extractPostsFromBodies(bodies, platform);
      errors += result.errors;
      return result.posts;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        page.off("response", onResponse);
      } catch {
        // listener already detached with the page
      }
    },
    stats() {
      return { responses: bodies.length, bytes: totalBytes, errors };
    },
  };
}
