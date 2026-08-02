// lib/scraper.ts's extractors fall back to the group/feed URL whenever they
// can't find a post-specific permalink in the DOM (Facebook/LinkedIn/X: the
// permalink anchor wasn't present for that post; Nextdoor: it never has one
// in the feed view at all — see extractNextdoorPosts's comment). Clicking
// "View original post" in that case just lands on the group's general feed,
// not the actual post, which reads as a broken link. Detecting this from the
// URL shape alone (no schema change / backfill needed) lets the UI label it
// honestly instead of always claiming "View original post".
const PERMALINK_MARKERS = ["/posts/", "/share/p/", "/permalink", "/status/", "/comments/", "/feed/update/"];

export function isExactPostUrl(postUrl: string | null): boolean {
  if (!postUrl) return false;
  return PERMALINK_MARKERS.some((marker) => postUrl.includes(marker));
}
