/**
 * Reddit application-only OAuth.
 *
 * Reddit closed unauthenticated `.json` reads. A plain request to
 * `www.reddit.com/r/<sub>/new.json` now answers 403, and `old.reddit.com`
 * answers 200 with a "Welcome to Reddit" interstitial — HTML dressed as a
 * success, which is worse, because a naive caller stores the page as post
 * text. Neither is a rate limit and neither recovers on retry: the door is
 * shut to anonymous clients permanently.
 *
 * The way through is the documented free tier. A registered app gets an
 * app-only bearer token via `client_credentials` and reads public listings
 * from `oauth.reddit.com` at 100 requests/minute — far more than this app
 * needs, at no cost. There is no per-user Reddit login involved: the token
 * belongs to the application, so it works identically on a laptop and on
 * serverless, which is precisely why Reddit is the one source type a hosted
 * customer can collect from at all.
 *
 * Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET from a "script" app created at
 * https://www.reddit.com/prefs/apps. Without them Reddit sources are reported
 * as needing setup rather than silently returning nothing.
 */

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

/**
 * Reddit asks for a descriptive User-Agent and throttles generic ones harder.
 * Shared with the read path so both halves identify the same client.
 */
export const REDDIT_USER_AGENT = "web:OpportunityAI:1.0 (by /u/opportunity-ai)";

interface CachedToken {
  token: string;
  /** Epoch ms after which we stop trusting it. */
  expiresAt: number;
}

/**
 * Module-level cache. Tokens last 24h, so refetching one per scrape run would
 * be a pointless round trip — and on serverless a warm instance reuses this
 * across invocations. A cold start just fetches again, which is correct.
 */
let cached: CachedToken | null = null;

/** In-flight token request, so concurrent scrapes share one round trip. */
let inFlight: Promise<string | null> | null = null;

export function hasRedditCredentials(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

export const REDDIT_SETUP_HINT =
  "Reddit needs API credentials. Create a 'script' app at https://www.reddit.com/prefs/apps, then set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.";

/**
 * Returns a valid app-only bearer token, or null when credentials are absent
 * or Reddit refused to issue one. Never throws — the caller reports a source
 * as unconfigured rather than crashing a whole scrape run over it.
 */
export async function getRedditToken(): Promise<string | null> {
  if (!hasRedditCredentials()) return null;

  // 60s of headroom: a token that expires mid-request is a 401 that looks
  // like a credentials problem and sends whoever debugs it the wrong way.
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const basic = Buffer.from(
        `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`
      ).toString("base64");

      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": REDDIT_USER_AGENT,
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) return null;

      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;

      cached = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      };
      return cached.token;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Rewrites a public reddit.com listing URL to its oauth.reddit.com equivalent.
 * The paths are identical; only the host and the dropped `.json` suffix differ,
 * because the OAuth host returns JSON for every listing endpoint.
 */
export function toOAuthUrl(publicJsonUrl: string): string {
  const u = new URL(publicJsonUrl);
  u.host = "oauth.reddit.com";
  u.pathname = u.pathname.replace(/\.json$/, "");
  return u.toString();
}
