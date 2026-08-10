import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/**
 * The sitemap.
 *
 * Only the pages a signed-out visitor can actually load. Listed longhand rather
 * than walked from the filesystem, so adding a route to the app never silently
 * publishes it — the same deny-by-default reasoning the middleware uses.
 *
 * `/login` is included on purpose even though it is a sign-in form: it is
 * currently the app's only page that describes the product to a stranger. That
 * is a thin indexable surface for a product meant to rank, and the fix is a
 * real marketing page at `/`, not a longer sitemap.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();

  return [
    { url: `${base}/login`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
