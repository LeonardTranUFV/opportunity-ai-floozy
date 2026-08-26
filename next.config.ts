import type { NextConfig } from "next";

/**
 * Security response headers.
 *
 * ── The CSP is now enforced ────────────────────────────────────────────────
 *
 * It shipped as `Report-Only` first, deliberately. This app is live and public,
 * and a Content-Security-Policy is the one header that can take a working
 * product offline by being slightly wrong — and this one has more moving parts
 * than most: the browser talks to Supabase directly, the location sheet
 * geocodes against nominatim from a *client* component and pulls tiles from
 * OpenStreetMap, and the walkthrough embeds an iframe whose src is a prop.
 *
 * Before enforcing, the whole client-side surface was enumerated rather than
 * assumed:
 *
 *   - **No client component fetches an absolute URL.** Every `fetch` in a
 *     `"use client"` file targets a relative `/api/…` path, which `'self'`
 *     always allows.
 *   - The only cross-origin traffic the browser makes is **Supabase** (through
 *     supabase-js) and **nominatim**, both named in `connect-src`, plus **OSM
 *     tiles** as images, named in `img-src`.
 *   - **Nothing loads from a CDN.** Leaflet's CSS is imported from
 *     `node_modules` and bundled, so it and its assets are same-origin; there
 *     is no `unpkg`/`jsdelivr`/`cdnjs` reference anywhere, and no dynamic
 *     script injection.
 *   - No third-party client SDK in the dependency list — nothing from
 *     analytics, Sentry, Stripe.js or similar that would phone home.
 *
 * `connect-src` is the directive that actually breaks a working app when
 * enforced, which is why that first point is the one that mattered.
 *
 * If something is ever added that legitimately needs another origin, the
 * symptom is a blocked request in the console and the fix is one entry here —
 * not turning the policy off.
 */

const isDev = process.env.NODE_ENV === "development";

/** The browser hits Supabase directly, so its origin has to be allowed. */
const supabaseOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    return raw ? new URL(raw).origin : "https://*.supabase.co";
  } catch {
    return "https://*.supabase.co";
  }
})();

const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is React Fast Refresh in development only.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Map tiles are images from OpenStreetMap's tile servers; blob:/data: are
  // canvas and inline SVG.
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.supabase.co",
  // next/font self-hosts Geist and Archivo at build time.
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} https://nominatim.openstreetmap.org${isDev ? " ws: wss:" : ""}`,
  // The walkthrough iframe takes its src as a prop, so the video host is not
  // known here. Narrow this to the actual provider once one is chosen.
  "frame-src 'self' https:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],

  /**
   * Ship Playwright's own files with the connect routes.
   *
   * Those routes never launch a browser — they attach to one already running
   * at the provider, over CDP. But `playwright-core` reads `browsers.json` at
   * import time regardless, and Next's file tracing does not follow a runtime
   * require of a JSON data file, so the deployed bundle was missing it:
   *
   *   Cannot find module '/var/task/node_modules/playwright-core/browsers.json'
   *
   * That failed at *import*, before a line of our code ran — which is why it
   * surfaced as a cloud browser stuck on about:blank rather than as a
   * navigation error, and why it would have taken /api/connect/finish down the
   * same way, losing a customer's completed login rather than a blank page.
   *
   * The whole package rather than just the one file: it is ~18 MB against a
   * 250 MB limit, and guessing which internals a future version happens to
   * read at import time is how this bug gets to happen twice. Browser
   * *binaries* are not included — those live in a separate cache directory,
   * and PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD keeps them out of the build.
   */
  outputFileTracingIncludes: {
    "/api/connect/**": [
      "./node_modules/playwright-core/**",
      "./node_modules/playwright/**",
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },

          // None of these can break a page that was already working.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
          },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
      {
        // Anything under /api is per-user and must never be held by a shared
        // cache. Vercel's edge will happily cache a response it thinks is
        // static, and one user's opportunities showing up for another is the
        // exact failure this prevents.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
