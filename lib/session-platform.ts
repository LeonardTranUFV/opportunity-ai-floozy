/**
 * Which saved login a source type actually uses.
 *
 * Marketplace has no login of its own — it is Facebook — so it resolves to the
 * Facebook session, both for finding the stored credentials and for deciding
 * which crawls may run at the same time.
 *
 * ── Why this is its own file ───────────────────────────────────────────────
 *
 * It lived in lib/scraper.ts, which is the right place for it conceptually and
 * the wrong one to import from. That module reaches Playwright, the feed
 * capture, the Reddit OAuth client and every extractor; pulling all of it into
 * a page or a settings check to answer "is this Reddit?" is a lot of module
 * graph for a one-line mapping.
 *
 * It is not a theoretical concern. Playwright must never be imported at module
 * scope in anything a route can reach — see lib/browser.ts, which exists
 * because a top-level import of it took a whole route down before its own auth
 * check could run. Today scraper.ts loads Playwright lazily and the edge is
 * harmless, but that is one careless import away from stopping being true, and
 * the failure it produces is a raw 500 rather than anything legible.
 *
 * A leaf module with no imports of its own cannot cause that, whoever reaches
 * for it.
 */
export function sessionPlatform(platform: string): string {
  return platform === "marketplace" ? "facebook" : platform;
}
