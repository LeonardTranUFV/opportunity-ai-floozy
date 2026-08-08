import type { NextConfig } from "next";

/**
 * Security response headers.
 *
 * ── Why the CSP is Report-Only ─────────────────────────────────────────────
 *
 * This app is live and public, and a Content-Security-Policy is the one header
 * that can take a working product offline by being slightly wrong. This one has
 * more moving parts than most:
 *
 *   - the browser talks to Supabase directly for auth and data
 *   - the location sheet geocodes against nominatim.openstreetmap.org from a
 *     *client* component, and loads map tiles from {s}.tile.openstreetmap.org
 *   - the walkthrough embeds an <iframe> whose src is a prop, so the provider
 *     is not known at build time
 *
 * Every one of those is a separate chance to break something real. Report-Only
 * gives the same visibility with none of the risk: violations are reported by
 * the browser, nothing is blocked. Watch the console on the live site for a few
 * days, confirm the policy is clean, then rename the header to
 * `Content-Security-Policy` to start enforcing. That rename is the entire
 * change — the policy below is already the one to enforce.
 *
 * Everything else here is enforced immediately, because none of it can break a
 * working page: they only remove abilities the app never uses.
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

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Report-only until the policy is confirmed clean against the live
          // site. See the note at the top of this file.
          { key: "Content-Security-Policy-Report-Only", value: csp },

          // Enforced. None of these can break a page that was already working.
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
