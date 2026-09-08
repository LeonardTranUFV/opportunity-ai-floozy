// lib/scraper.ts's extractors fall back to the group/feed URL whenever they
// can't find a post-specific permalink in the DOM (Facebook/LinkedIn/X: the
// permalink anchor wasn't present for that post; Nextdoor: it never has one
// in the feed view at all — see extractNextdoorPosts's comment). Clicking
// "View original post" in that case just lands on the group's general feed,
// not the actual post, which reads as a broken link. Detecting this from the
// URL shape alone (no schema change / backfill needed) lets the UI label it
// honestly instead of always claiming "View original post".
//
// `/marketplace/item/` belongs here and was missing, which made this function
// wrong about an entire platform rather than about the odd post. Every
// Marketplace listing is stored as
// `https://www.facebook.com/marketplace/item/<id>` — extractMarketplaceListings
// builds it from the id it just parsed, so it is always exact and never a
// fallback. Measured against the live database: all 123 stored Marketplace
// listings were being reported as "exact post link unavailable".
//
// The cost of that omission was not cosmetic, because four call sites branch
// on this answer: the Opportunities link label, the comment route (which
// refuses to act without an exact link), dedupe scoring, and the scan's
// per-target grouping — where every no-permalink row collapses into one
// shared slot, so distinct listings were being folded into a single card.
const PERMALINK_MARKERS = [
  "/posts/",
  "/share/p/",
  "/permalink",
  "/status/",
  "/comments/",
  "/feed/update/",
  "/marketplace/item/",
];

export function isExactPostUrl(postUrl: string | null): boolean {
  if (!postUrl) return false;
  return PERMALINK_MARKERS.some((marker) => postUrl.includes(marker));
}
