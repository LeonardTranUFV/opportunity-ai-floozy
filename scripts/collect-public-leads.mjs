/**
 * Fill `public_leads` — the corpus behind the free scan.
 *
 *   node scripts/collect-public-leads.mjs --dry        # look, write nothing
 *   node scripts/collect-public-leads.mjs              # collect and upsert
 *   node scripts/collect-public-leads.mjs --region bc
 *
 * Runs operator-side, on our own account, against sources anyone can read
 * without logging in. That constraint is not incidental: everything this
 * writes gets shown to anonymous visitors, so a row that arrived through a
 * customer's connected session must never reach this table. See the header of
 * migration 0012.
 *
 * Sources are pluggable because the good one is not available yet. Reddit's
 * public per-subreddit feed works today and costs nothing, but it is thin —
 * it holds only the newest ~25 posts, which on a busy subreddit is hours, so
 * this has to run on a schedule to accumulate anything. A search API (Brave,
 * Serper) would return 90 days of history in one call and is the real answer;
 * `SEARCH_API_KEY` switches it on when that decision is made.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, both already
 * in .env.worker. Migration 0012 must be applied first.
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

const has = (f) => process.argv.includes(`--${f}`);
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}

config({ path: path.resolve(projectRoot, arg("env", ".env.worker")) });

const DRY = has("dry");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DRY && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.log("\nNEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to write.");
  console.log("Both are in .env.worker. Use --dry to preview without them.\n");
  process.exit(1);
}

/**
 * City subreddits, grouped by region so a run can be scoped.
 *
 * r/vancouver is British Columbia; r/vancouverwa is Washington State. Mixing
 * them files leads 500km away in another country under a BC contractor's city,
 * and the posts read perfectly plausibly, so the mistake survives review. Every
 * entry here names the city the rows will be filed under, rather than trusting
 * the subreddit name to mean what it looks like.
 */
const SUBS = {
  bc: [
    { sub: "vancouver", city: "vancouver", region: "BC" },
    { sub: "AskVan", city: "vancouver", region: "BC" },
    { sub: "burnaby", city: "burnaby", region: "BC" },
    { sub: "SurreyBC", city: "surrey", region: "BC" },
    { sub: "Coquitlam", city: "coquitlam", region: "BC" },
    { sub: "NewWestminster", city: "new westminster", region: "BC" },
    { sub: "RichmondBC", city: "richmond", region: "BC" },
  ],
  on: [
    { sub: "askTO", city: "toronto", region: "ON" },
    { sub: "toronto", city: "toronto", region: "ON" },
    { sub: "ottawa", city: "ottawa", region: "ON" },
    { sub: "Hamilton", city: "hamilton", region: "ON" },
    { sub: "kitchener", city: "kitchener", region: "ON" },
  ],
  ab: [
    { sub: "Calgary", city: "calgary", region: "AB" },
    { sub: "Edmonton", city: "edmonton", region: "AB" },
  ],
};

/**
 * Trade detection. The keys match the normalised trades /api/scan/preview
 * resolves to, so a scan for "roofer" finds rows filed under "roofing".
 */
const TRADES = {
  roofing: ["roofer", "roofing", "roof leak", "reroof", "shingle", "re-shingle"],
  plumbing: ["plumber", "plumbing", "burst pipe", "leaking pipe", "hot water tank", "drain"],
  electrical: ["electrician", "electrical panel", "rewire", "breaker", "outlet"],
  painting: ["painter", "painting", "repaint", "paint job"],
  flooring: ["flooring", "laminate", "hardwood floor", "vinyl plank", "tile floor"],
  hvac: ["hvac", "furnace", "heat pump", "air conditioning", "ac unit"],
  landscaping: ["landscaper", "landscaping", "yard cleanup", "lawn care"],
  renovation: ["contractor", "renovation", "reno ", "remodel", "general contractor"],
};

/** What separates "I need one" from "here is my opinion about one". */
const INTENT = [
  "recommend", "recommendation", "looking for", "anyone know", "need a", "need an",
  "suggestions", "who do you use", "hire", "quote", "estimate", "help with", "any good",
];

/** Words that mean the poster is selling, not buying. */
const EXCLUDE = ["i am a", "i'm a", "my company", "dm me", "hiring", "we offer", "free estimate"];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PACE_MS = 2000;

function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const b = m[1];
    const pick = (tag) => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [, ""])[1];
    return {
      id: pick("id"),
      title: decode(pick("title")),
      body: decode(pick("content").replace(/<[^>]+>/g, " ")),
      at: Date.parse(pick("updated")),
      url: (b.match(/<link[^>]*href="([^"]+)"/) ?? [, ""])[1],
    };
  });
}

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

function classify(text) {
  const lower = text.toLowerCase();
  if (EXCLUDE.some((x) => lower.includes(x))) return null;
  if (!INTENT.some((i) => lower.includes(i))) return null;
  for (const [trade, words] of Object.entries(TRADES)) {
    if (words.some((w) => lower.includes(w))) return trade;
  }
  return null;
}

/**
 * A crude urgency score, deliberately labelled as crude.
 *
 * The real scorer is lib/ai.ts and it runs against Gemini on the server. This
 * exists so a freshly collected row is not null-scored on a page that sorts by
 * score — it is a placeholder ranking, not a judgement, and rows are rescored
 * properly once they are in.
 */
function roughScore(text, ageHours) {
  const lower = text.toLowerCase();
  let score = 60;
  if (/asap|urgent|today|emergency|right away|immediately/.test(lower)) score += 20;
  if (/quote|estimate|hire|budget/.test(lower)) score += 10;
  if (/\$|\bcost\b|\bprice\b/.test(lower)) score += 5;
  if (ageHours < 24) score += 8;
  else if (ageHours > 24 * 30) score -= 15;
  if (text.length < 80) score -= 10;
  return Math.max(1, Math.min(99, score));
}

const region = arg("region");
const targets = region ? SUBS[region] : Object.values(SUBS).flat();
if (region && !SUBS[region]) {
  console.log(`Unknown region "${region}". Known: ${Object.keys(SUBS).join(", ")}\n`);
  process.exit(1);
}

console.log(
  `\nCollecting public leads · ${targets.length} subreddits${DRY ? " · DRY RUN" : ""}\n${"-".repeat(64)}`
);

const found = [];
let blocked = 0;

for (const target of targets) {
  let xml;
  try {
    const res = await fetch(`https://www.reddit.com/r/${target.sub}/new.rss?limit=25`, {
      headers: { "User-Agent": UA, Accept: "application/atom+xml,text/xml,*/*" },
    });
    if (res.status === 429) {
      blocked++;
      console.log(`${target.sub.padEnd(18)} rate limited`);
      await new Promise((r) => setTimeout(r, PACE_MS * 3));
      continue;
    }
    if (!res.ok) {
      console.log(`${target.sub.padEnd(18)} HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, PACE_MS));
      continue;
    }
    xml = await res.text();
  } catch (err) {
    console.log(`${target.sub.padEnd(18)} unreachable — ${err.message}`);
    await new Promise((r) => setTimeout(r, PACE_MS));
    continue;
  }

  const hits = [];
  for (const entry of parseFeed(xml)) {
    if (!Number.isFinite(entry.at)) continue;
    const text = `${entry.title} ${entry.body}`;
    const trade = classify(text);
    if (!trade) continue;

    hits.push({
      source: "reddit",
      source_url: entry.url,
      external_id: entry.id,
      posted_at: new Date(entry.at).toISOString(),
      // Title plus a trimmed body: enough for a stranger to judge the job,
      // short enough to read in a card.
      content: `${entry.title}${entry.body ? ` — ${entry.body.slice(0, 300)}` : ""}`,
      trade,
      city: target.city,
      region: target.region,
      intent_score: roughScore(text, (Date.now() - entry.at) / 3_600_000),
    });
  }

  found.push(...hits);
  console.log(`${target.sub.padEnd(18)} ${String(hits.length).padStart(2)} matched`);
  await new Promise((r) => setTimeout(r, PACE_MS));
}

console.log("-".repeat(64));

if (!found.length) {
  console.log(
    `\nNothing matched this pass.${blocked ? ` ${blocked} subreddit(s) were rate limited — rerun.` : ""}\n` +
      `That is normal for Reddit: the feed holds only the newest ~25 posts, so a\n` +
      `single run sees a few hours. Run it on a schedule, or wire a search API for\n` +
      `real history.\n`
  );
  process.exit(0);
}

console.log(`\n${found.length} lead${found.length === 1 ? "" : "s"}:\n`);
for (const f of found.slice(0, 15)) {
  const age = Math.round((Date.now() - Date.parse(f.posted_at)) / 3_600_000);
  console.log(`  ${String(f.intent_score).padStart(2)}  ${f.trade.padEnd(12)} ${f.city.padEnd(15)} ${age}h  ${f.content.slice(0, 62)}`);
}

if (DRY) {
  console.log(`\nDry run — nothing written.\n`);
  process.exit(0);
}

// Upsert on (source, external_id) so re-running refreshes rather than duplicates.
const res = await fetch(`${SUPABASE_URL}/rest/v1/public_leads?on_conflict=source,external_id`, {
  method: "POST",
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify(found),
});

if (!res.ok) {
  const detail = (await res.text()).slice(0, 300);
  console.log(`\nWrite failed (${res.status}): ${detail}`);
  if (/public_leads/.test(detail) && res.status === 404) {
    console.log("\nmigration 0012_public_leads.sql has not been applied yet.");
  }
  process.exit(1);
}

console.log(`\n${found.length} row(s) upserted into public_leads. The free scan can see them now.\n`);
