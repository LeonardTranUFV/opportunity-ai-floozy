import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/**
 * The sitemap.
 *
 * Only the pages a signed-out visitor can actually load. Listed longhand rather
 * than walked from the filesystem, so adding a route to the app never silently
 * publishes it — the same deny-by-default reasoning the middleware uses.
 *
 * `/` is the marketing page — signed-out visitors are rewritten there from the
 * middleware, so it is the page a crawler actually receives and the one worth
 * ranking. `/welcome`, the rewrite target, is deliberately absent.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
