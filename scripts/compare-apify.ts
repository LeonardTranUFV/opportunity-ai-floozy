// Read-only comparison: what Apify returns for our Facebook groups, against
// what the browser path has already collected for the same ones.
//
// WRITES NOTHING. Not to `posts`, not to `groups`, not to `evaluated_posts`.
// The point is to decide whether to switch collection paths, and a comparison
// that mutates the thing being measured is not a comparison. Run it, read the
// table, then decide.
//
// The three numbers that matter:
//
//   posts        — does it find anything at all for our actual sources
//   % dated      — the browser path measured 17% on 2,423 Facebook rows
//                  (commit 32925c2). Anything near that is no improvement;
//                  anything well above it is the undated-lead problem solved
//                  at the source rather than filtered in the UI.
//   % new        — posts we do not already have. High is good on the first
//                  run and meaningless after, since the browser path keeps
//                  collecting while this is being evaluated.
//
// Usage: npx tsx scripts/compare-apify.ts [--env .env.worker] [--days 7] [--limit 50]

import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { scrapeGroupsViaApify } from "@/lib/apify-scraper";
import type { GroupToScrape } from "@/lib/scraper";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const envFile = flag("env", ".env");
const loaded = config({ path: path.resolve(projectRoot, envFile) });
if (loaded.error && process.argv.includes("--env")) {
  console.error(`[compare-apify] could not read ${envFile}: ${loaded.error.message}`);
  process.exit(1);
}
console.log(`[compare-apify] credentials from ${envFile}`);

const sinceDays = Number(flag("days", "7"));
const resultsLimit = Number(flag("limit", "50"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!process.env.APIFY_TOKEN) {
  console.error("Missing APIFY_TOKEN — add it to your env file first.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

async function main() {
  const { data: groups, error } = await supabase
    .from("groups")
    .select("id, platform, name, url")
    .eq("active", true)
    .eq("platform", "facebook");

  if (error) {
    console.error("[compare-apify] failed to load groups:", error.message);
    process.exit(1);
  }
  if (!groups || groups.length === 0) {
    console.log("[compare-apify] no active Facebook groups to compare.");
    return;
  }

  console.log(
    `[compare-apify] ${groups.length} active Facebook group(s), last ${sinceDays} day(s), up to ${resultsLimit} posts each\n`
  );

  const result = await scrapeGroupsViaApify(groups as GroupToScrape[], {
    budgetMs: 10 * 60_000,
    sinceDays,
    resultsLimit,
  });

  for (const line of result.log) console.log(`  ${line}`);

  const posts = result.posts;
  if (posts.length === 0) {
    console.log("\nNothing returned. If every group logged an error above, that is the answer.");
    console.log("If they logged 0 posts cleanly, the groups may be private — Apify reads public groups only.");
    return;
  }

  // Which of these we already hold. Checked in chunks because `.in()` becomes
  // a query string, the same reason scan-agent.ts chunks its lookup.
  const ids = posts.map((p) => p.external_post_id);
  const known = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await supabase
      .from("posts")
      .select("external_post_id")
      .in("external_post_id", ids.slice(i, i + CHUNK));
    for (const row of data ?? []) known.add(row.external_post_id as string);
  }

  const dated = posts.filter((p) => p.posted_at).length;
  const fresh = posts.filter((p) => !known.has(p.external_post_id)).length;
  const withUrl = posts.filter((p) => p.post_url).length;

  console.log("\n─────────────────────────────────────────────");
  console.log(`  posts returned   ${posts.length}`);
  console.log(`  with a real date ${dated}  (${pct(dated, posts.length)})   browser path measured 17%`);
  console.log(`  with a permalink ${withUrl}  (${pct(withUrl, posts.length)})   browser path measured 34%`);
  console.log(`  not already held ${fresh}  (${pct(fresh, posts.length)})`);
  console.log("─────────────────────────────────────────────");
  console.log("\nNothing was written. Re-run with a different APIFY_FACEBOOK_ACTOR to compare actors.");

  const sample = posts.find((p) => p.posted_at) ?? posts[0];
  console.log("\nSample post:");
  console.log(`  author   ${sample.author_name}`);
  console.log(`  posted   ${sample.posted_at ?? "(no date)"}`);
  console.log(`  url      ${sample.post_url ?? "(none)"}`);
  console.log(`  text     ${sample.raw_text.replace(/\s+/g, " ").slice(0, 160)}`);
}

main().catch((err) => {
  console.error("[compare-apify]", err instanceof Error ? err.message : err);
  process.exit(1);
});
