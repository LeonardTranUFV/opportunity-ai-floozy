/**
 * The Meta Pixel event vocabulary for this funnel, in one place.
 *
 * Two reasons this is a module and not a scattering of `fbq(...)` calls.
 *
 * First, event *names* are load-bearing in a way that reads as cosmetic. Meta
 * optimises delivery against a chosen conversion event, and it only optimises
 * well against events it recognises — a custom "GotLeads" gets counted but not
 * modelled, while `ViewContent` feeds the same machinery every other
 * advertiser trains on. So each step of our funnel is mapped onto the nearest
 * standard event rather than named after our own UI.
 *
 * Second, a typo in an event name is invisible. `fbq('track', 'StartTral')` is
 * not an error anywhere — it posts happily, and the ad account simply reports
 * no trials while the campaign optimises toward nothing. Going through a typed
 * map means the compiler catches what Meta never will.
 *
 * Every call is a no-op when the pixel is absent (no id configured, script
 * blocked, ad blocker), so callers never need to guard.
 */

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[] };
  }
}

/**
 * Our five funnel steps, mapped to standard Meta events.
 *
 *   scanStarted   — they submitted trade + city on the public scan page.
 *   resultsShown  — real matched posts came back. The moment that sells.
 *   paywallSeen   — they reached the ask.
 *   trialStarted  — card entered, 3-day trial open.
 *   subscribed    — trial converted to paid.
 *
 * `resultsShown` is the one worth watching most closely: it separates "the ad
 * lied" from "the ad worked and the product underdelivered", which are fixed
 * in completely different places.
 */
export const PIXEL_EVENTS = {
  scanStarted: "Lead",
  resultsShown: "ViewContent",
  paywallSeen: "InitiateCheckout",
  trialStarted: "StartTrial",
  subscribed: "Subscribe",
} as const;

export type PixelEvent = keyof typeof PIXEL_EVENTS;

/** True once the base script has loaded and `fbq` is real rather than queued. */
export function pixelReady(): boolean {
  return typeof window !== "undefined" && typeof window.fbq === "function";
}

/**
 * Reports one funnel step.
 *
 * `params` reaches Meta as event properties — keep it to things worth
 * segmenting on later (trade, city, how many results came back) and never put
 * anything that identifies a person in it.
 */
export function trackPixel(event: PixelEvent, params?: Record<string, unknown>): void {
  if (!pixelReady()) return;
  window.fbq?.("track", PIXEL_EVENTS[event], params ?? {});
}

/**
 * Re-reports a page view after a client-side navigation.
 *
 * Meta's base snippet fires PageView exactly once, when the script loads. In
 * an app that routes without a document load, every screen after the first
 * would otherwise go unrecorded — so the landing page would look like the only
 * page anyone ever visits.
 */
export function trackPixelPageView(): void {
  if (!pixelReady()) return;
  window.fbq?.("track", "PageView");
}
