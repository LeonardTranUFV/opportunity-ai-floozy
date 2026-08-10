/**
 * The cheap tier of the fetch ladder.
 *
 * Launching a persistent Chromium context costs seconds of wall clock, a real
 * Chrome profile on disk, and a login — so it should be the last resort, not
 * the default. Most of the public web answers a plain HTTP request with
 * ordinary browser headers, and for those a `fetch` is roughly two orders of
 * magnitude cheaper than driving a browser.
 *
 * The ladder, cheapest first:
 *   1. `fetchPlain` — this module. Public pages and JSON APIs.
 *   2. Browser via `lib/scraper.ts` — JS-rendered content, and anything behind
 *      a login (Facebook, LinkedIn, Nextdoor, X), where the user's own session
 *      is the whole point and no amount of header spoofing substitutes.
 *
 * `classifyResponse` exists so a caller can tell the difference between "this
 * page needs a browser" and "this page is gone", instead of escalating to
 * Chromium on every failure.
 */

import { isPrivateHost } from "@/lib/validate";

/**
 * Headers a real Chrome sends. Not an attempt to defeat bot detection — sites
 * routinely 403 requests with no Accept-Language or a bare default user agent
 * even when they're happy to serve the content, so this is about not being
 * gratuitously identifiable as a script while reading public pages.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export type FetchVerdict =
  /** Usable response. */
  | "ok"
  /** Actively refused — a browser session might get through where this didn't. */
  | "blocked"
  /** Asked to slow down. Back off; escalating to a browser won't help. */
  | "rate_limited"
  /** Gone or broken. Escalating won't help either. */
  | "error";

export interface PlainFetchResult {
  verdict: FetchVerdict;
  status: number;
  body: string;
  contentType: string;
  /** Round-trip time, fed back into the throttle. */
  elapsedMs: number;
  error: string | null;
}

/**
 * Reads which failures a browser could plausibly fix.
 *
 * 403 and 503 are the shapes anti-bot layers use (the Scrapling walkthrough's
 * own test found YellowPages, Yelp and ThomasNet all 403 to a plain request
 * while BBB returned 200), so those are worth escalating. 404/410 are the site
 * telling the truth, and 429 is a pacing problem that a browser would hit too.
 */
export function classifyResponse(status: number): FetchVerdict {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429) return "rate_limited";
  if (status === 403 || status === 401 || status === 503) return "blocked";
  return "error";
}

const MAX_REDIRECTS = 5;

/**
 * SSRF guard, owned here rather than at each call site.
 *
 * Source URLs are customer-supplied and are *not* run through `httpUrl()` when
 * a source is added, so a "reddit" source pointed at 169.254.169.254 would
 * otherwise have this server fetch its own cloud instance metadata and store
 * the response as post text. Putting the check in the shared helper means
 * every future caller of the cheap tier inherits it instead of having to
 * remember, and it can be re-applied to each redirect hop.
 */
export function checkTarget(url: string): { url: URL } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `not a valid URL: ${url}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `refusing a non-http(s) URL: ${parsed.protocol}` };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { error: `refusing a private/loopback address: ${parsed.hostname}` };
  }
  return { url: parsed };
}

export async function fetchPlain(
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<PlainFetchResult> {
  const started = Date.now();

  const refuse = (error: string): PlainFetchResult => ({
    verdict: "error",
    status: 0,
    body: "",
    contentType: "",
    elapsedMs: Date.now() - started,
    error,
  });

  const firstHop = checkTarget(url);
  if ("error" in firstHop) return refuse(firstHop.error);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    let current = firstHop.url;
    let response: Response | null = null;

    // Redirects are followed by hand so every hop passes the same guard.
    // `redirect: "follow"` would let a public URL 302 into 169.254.169.254 and
    // walk straight past the check above — the standard way an SSRF filter
    // that only inspects the first URL gets bypassed.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetch(current.toString(), {
        headers: { ...BROWSER_HEADERS, ...options.headers },
        signal: controller.signal,
        redirect: "manual",
      });

      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400 && location;
      if (!isRedirect) break;

      if (hop === MAX_REDIRECTS) {
        return refuse(`Too many redirects (more than ${MAX_REDIRECTS}) starting at ${url}`);
      }

      // Relative Location headers are legal and common; resolve against the
      // hop we're on, then re-check the result.
      const next = checkTarget(new URL(location, current).toString());
      if ("error" in next) return refuse(`Redirect refused — ${next.error}`);
      current = next.url;
    }

    if (!response) return refuse("No response");

    const contentType = response.headers.get("content-type") ?? "";
    // Cap what we read. A misrouted request can land on a multi-megabyte
    // asset, and nothing downstream benefits from holding it in memory.
    const raw = await response.text();
    const body = raw.length > MAX_BODY_BYTES ? raw.slice(0, MAX_BODY_BYTES) : raw;

    return {
      verdict: classifyResponse(response.status),
      status: response.status,
      body,
      contentType,
      elapsedMs: Date.now() - started,
      error: null,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      verdict: "error",
      status: 0,
      body: "",
      contentType: "",
      elapsedMs: Date.now() - started,
      error: aborted ? `Timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` : String(err),
    };
  } finally {
    // Without this the abort timer stays armed for the full timeout after a
    // fast response, holding the event loop open — enough of them and a
    // finished scrape run just sits there instead of exiting.
    clearTimeout(timer);
  }
}

const MIN_DELAY_MS = 400;
const MAX_DELAY_MS = 30_000;
const START_DELAY_MS = 900;

/**
 * Per-host adaptive pacing.
 *
 * A fixed random sleep between requests is either too slow for a host that
 * doesn't mind, or too fast for one that does, and it can't tell the
 * difference. This tracks each host separately and lets its own responses set
 * the pace: a rate-limit or a block quadruples the delay, a slow response
 * nudges it up (a server taking its time is a server under load), and a run of
 * quick successes walks it back down toward the floor.
 *
 * State is per-process and deliberately not persisted — a scrape run is the
 * useful lifetime, and carrying a punitive delay across runs would slow down
 * recovery for no benefit.
 */
export class DomainThrottle {
  private delays = new Map<string, number>();
  private lastRequestAt = new Map<string, number>();

  private hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  /** Sleeps as long as this host currently warrants before its next request. */
  async pace(url: string): Promise<void> {
    const host = this.hostOf(url);
    const delay = this.delays.get(host) ?? START_DELAY_MS;
    const last = this.lastRequestAt.get(host);
    const now = Date.now();

    if (last !== undefined) {
      const waitFor = last + delay - now;
      if (waitFor > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitFor));
      }
    }
    this.lastRequestAt.set(host, Date.now());
  }

  /** Feeds a completed request back in so the next delay reflects reality. */
  record(url: string, result: Pick<PlainFetchResult, "verdict" | "elapsedMs">): void {
    const host = this.hostOf(url);
    const current = this.delays.get(host) ?? START_DELAY_MS;

    let next: number;
    if (result.verdict === "rate_limited" || result.verdict === "blocked") {
      next = current * 4;
    } else if (result.verdict === "error") {
      next = current * 2;
    } else if (result.elapsedMs > 2000) {
      // Slow but successful: ease off rather than hammer a struggling host.
      next = current * 1.5;
    } else {
      // Healthy and fast — converge back toward the floor, gradually enough
      // that one lucky response doesn't undo a real backoff.
      next = current * 0.8;
    }

    this.delays.set(host, Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(next))));
  }

  /** Current delay for a host, for logging and tests. */
  delayFor(url: string): number {
    return this.delays.get(this.hostOf(url)) ?? START_DELAY_MS;
  }
}

/** Fetch with this host's current pacing applied, and feed the result back. */
export async function fetchPaced(
  url: string,
  throttle: DomainThrottle,
  options?: { timeoutMs?: number; headers?: Record<string, string> }
): Promise<PlainFetchResult> {
  await throttle.pace(url);
  const result = await fetchPlain(url, options);
  throttle.record(url, result);
  return result;
}
