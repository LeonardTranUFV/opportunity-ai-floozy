/**
 * Playwright must never be imported at module scope in anything a route can
 * reach. Vercel's serverless bundle cannot load it, and a top-level import
 * takes the whole module down before a single line of the handler runs — so
 * the route's own auth check never fires and the user gets a raw 500 crash
 * page instead of an explanation. That is exactly what happened to Scan,
 * which is otherwise written to work fine without a browser.
 *
 * Import it through here instead, inside the code path that actually needs a
 * browser, so the failure stays local to that path.
 */
export async function getChromium() {
  const { chromium } = await import("playwright");
  return chromium;
}
