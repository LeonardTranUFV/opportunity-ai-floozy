import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/**
 * `robots.txt`, generated rather than static so the sitemap line carries the
 * real host.
 *
 * Nearly all of this app is signed-in surface, so the disallow list is long and
 * the allow list is the short one. Everything under the app shell is somebody's
 * private opportunity data; a crawler that followed a link into it would only
 * ever be handed `/login` anyway, and letting it try wastes crawl budget on a
 * site that has very few indexable pages to spend it on.
 *
 * `/auth/` is disallowed specifically: confirmation and recovery links carry
 * single-use tokens in the query string, and those must never reach an index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/pricing", "/terms", "/privacy"],
      disallow: [
        "/api/",
        "/auth/",
        // The rewrite target behind "/". Indexing it would put the same page in
        // twice under two URLs.
        "/welcome",
        "/agents",
        "/opportunities",
        "/communities",
        "/settings",
        "/crm",
        "/tools",
        "/guide",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
