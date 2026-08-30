/**
 * Is there actually enough on Reddit to make the free scan impressive?
 *
 *   node scripts/check-reddit-density.mjs
 *   node scripts/check-reddit-density.mjs --env .env.local --days 90
 *   node scripts/check-reddit-density.mjs --trade roofer
 *
 * The free scan is the whole acquisition funnel: a stranger types their trade
 * and city and, within a minute, has to see real people asking for that trade
 * nearby. If that list comes back with two thin results, no landing page and
 * no ad creative can save it — and we would only find that out after spending
 * the ad budget.
 *
 * So this answers the question up front, for free. It runs the same app-only
 * OAuth path the product uses (lib/reddit-auth.ts), issues the searches the
 * scan would issue, and reports how many genuine requests land inside the
 * lookback window — plus the five most recent, verbatim, because those are
 * literally what a prospect would see.
 *
 * Reads REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET. Never prints them.
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

config({ path: path.resolve(projectRoot, arg("env", ".env.local")) });

const DAYS = Number(arg("days", "90"));
const ONLY_TRADE = arg("trade", null);

/**
 * Metro Vancouver, because that is where the business operates — the same
 * scope as CITY_CLUSTERS in lib/nearby-cities.ts.
 *
 * One trap worth naming: r/vancouver is British Columbia, r/vancouverwa is
 * Vancouver, Washington. Including the wrong one quietly fills a BC
 * contractor's results with leads 500km away in another country, and the
 * posts read perfectly plausibly. Only verified BC subs belong in this list.
 */
const SUBS = [
  "vancouver",
  "AskVan",
  "britishcolumbia",
  "burnaby",
  "SurreyBC",
  "NewWestminster",
  "Coquitlam",
  "RichmondBC",
  "Delta_BC",
  "MapleRidge",
  "HomeImprovement",
  "Renovations",
];

/**
 * Trades to probe, with the words people actually use when they want one.
 *
 * Nobody posts "seeking roofing services." They post "roof is leaking" and
 * "anyone know a good roofer." Searching the trade noun alone finds mostly
 * contractors advertising and homeowners complaining about a past job, which
 * is why each trade carries its own intent vocabulary.
 */
const TRADES = {
  roofer: ["roofer", "roofing", "roof leak", "reroof"],
  contractor: ["contractor", "renovation", "reno quote", "general contractor"],
  plumber: ["plumber", "plumbing", "burst pipe", "leaking pipe"],
  electrician: ["electrician", "electrical panel", "rewire"],
  landscaper: ["landscaper", "landscaping", "yard cleanup"],
  painter: ["painter", "painting quote", "repaint"],
};

/**
 * Phrases that separate "I need one" from "here is my opinion about one".
 * Deliberately loose — this script is measuring whether a signal exists at
 * all, not scoring leads. The product's own scorer does the real judging.
 */
const INTENT = [
  "recommend",
  "recommendation",
  "looking for",
  "anyone know",
  "need a",
  "need an",
  "suggestions",
  "who do you use",
  "hire",
  "quote",
  "help with",
];

const USER_AGENT = "web:OpportunityAI:1.0 (by /u/opportunity-ai)";

const id = process.env.REDDIT_CLIENT_ID;
const secret = process.env.REDDIT_CLIENT_SECRET;

if (!id || !secret) {
  console.log(
    "\nREDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are not set.\n" +
      "Create a 'script' app at https://www.reddit.com/prefs/apps, put both in\n" +
      ".env.local (and in Vercel Production), then run this again.\n"
  );
  process.exit(1);
}

async function token() {
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    console.log(
      `\nReddit refused the credentials (${res.status}). A retry will not fix this —\n` +
        "check that the app is type 'script' and that the secret is the secret,\n" +
        "not the app id shown under the app name.\n"
    );
    process.exit(1);
  }
  return (await res.json()).access_token;
}

async function search(bearer, query) {
  const subs = SUBS.map((s) => `subreddit:${s}`).join(" OR ");
  const q = `(${subs}) (${query})`;
  const url =
    `https://oauth.reddit.com/search?q=${encodeURIComponent(q)}` +
    `&sort=new&limit=100&t=year&type=link&raw_json=1`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, "User-Agent": USER_AGENT },
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json?.data?.children ?? []).map((c) => c.data);
}

function ageDays(post) {
  return (Date.now() / 1000 - post.created_utc) / 86400;
}

function looksLikeARequest(post) {
  const text = `${post.title} ${post.selftext ?? ""}`.toLowerCase();
  return INTENT.some((phrase) => text.includes(phrase));
}

const bearer = await token();
console.log(
  `\nReddit density · last ${DAYS} days · ${SUBS.length} BC subreddits\n` +
    `${"-".repeat(58)}\n`
);

const trades = ONLY_TRADE ? { [ONLY_TRADE]: TRADES[ONLY_TRADE] } : TRADES;
if (ONLY_TRADE && !TRADES[ONLY_TRADE]) {
  console.log(`Unknown trade "${ONLY_TRADE}". Known: ${Object.keys(TRADES).join(", ")}\n`);
  process.exit(1);
}

const summary = [];

for (const [trade, terms] of Object.entries(trades)) {
  const seen = new Map();

  for (const term of terms) {
    for (const post of await search(bearer, `"${term}"`)) {
      if (ageDays(post) > DAYS) continue;
      if (!looksLikeARequest(post)) continue;
      seen.set(post.id, post);
    }
    // Comfortably inside Reddit's 100 requests/minute free-tier allowance.
    await new Promise((r) => setTimeout(r, 300));
  }

  const posts = [...seen.values()].sort((a, b) => b.created_utc - a.created_utc);
  summary.push({ trade, count: posts.length });

  const verdict =
    posts.length >= 10 ? "GOOD" : posts.length >= 5 ? "THIN" : "DEAD";
  console.log(`${trade.padEnd(14)} ${String(posts.length).padStart(3)} posts   ${verdict}`);

  for (const post of posts.slice(0, 5)) {
    const age = Math.round(ageDays(post));
    const title = post.title.length > 78 ? `${post.title.slice(0, 75)}…` : post.title;
    console.log(`   ${String(age).padStart(3)}d  r/${post.subreddit.padEnd(16)} ${title}`);
  }
  console.log("");
}

const best = summary.sort((a, b) => b.count - a.count)[0];
console.log(`${"-".repeat(58)}`);
console.log(
  best.count >= 10
    ? `Lead with "${best.trade}" — ${best.count} real requests in ${DAYS} days is enough\n` +
        `to fill a free scan. Build the landing page around that trade.\n`
    : `Nothing here clears 10 posts in ${DAYS} days. Do not buy traffic yet.\n` +
        `Widen first: add subreddits, lengthen the window, or take the scan to a\n` +
        `denser metro. A free scan that returns three results will not sell.\n`
);
