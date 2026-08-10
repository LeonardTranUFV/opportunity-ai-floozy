/**
 * The app's own public origin.
 *
 * `sitemap.xml`, `robots.txt` and the Open Graph tags all have to emit absolute
 * URLs — a sitemap of relative paths is not a sitemap, and a relative OG image
 * is ignored by every scraper that matters.
 *
 * Read from the environment so preview deployments describe themselves rather
 * than pointing a crawler at production. `NEXT_PUBLIC_SITE_URL` wins if set,
 * which is how this moves onto a custom domain later without a code change.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return "https://opportunity-ai-floozy.vercel.app";
}
