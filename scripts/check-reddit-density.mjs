/**
 * How much live trade demand actually flows through Reddit, and how fast it
 * scrolls past?
 *
 *   node scripts/check-reddit-density.mjs
 *   node scripts/check-reddit-density.mjs --region ca
 *   node scripts/check-reddit-density.mjs --subs vancouver,toronto,seattle
 *
 * No credentials. This deliberately uses the public per-subreddit Atom feed
 * (`/r/<sub>/new.rss`), which still answers an anonymous request — verified
 * 2026-08-30, 200 and a full feed — rather than the Data API, which Reddit now
 * grants only on request and effectively only for moderation use cases. See
 * memory: opportunity-ai-reddit-api-gated.
 *
 * Two numbers come out of this, and they answer different questions:
 *
 *   HITS  — trade requests visible right now. Whether there is demand at all.
 *   DEPTH — how many hours of posting the newest 25 entries span. This is the
 *           one people forget. The feed is a window, not an archive: on a busy
 *           subreddit it can be under an hour, which means anything we don't
 *           collect within that hour is gone for good, and it means a brand
 *           new customer has no history to be impressed by.
 *
 * DEPTH sets the polling interval we would have to run, and it is the reason
 * the "last 90 days" version of the free scan cannot be built on feeds alone.
 */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * City subreddits carry the actual requests; the trade subreddits carry
 * national volume and act as a control — if the trade subs are busy and the
 * city subs are empty, the problem is our geography, not the idea.
 *
 * r/vancouver is British Columbia. r/vancouverwa is Washington State. Mixing
 * them puts leads 500km away into a contractor's results, and the posts read
 * perfectly plausibly, so the mistake survives review.
 */
const REGIONS = {
  ca: [
    "vancouver", "AskVan", "britishcolumbia", "toronto", "askTO", "ontario",
    "calgary", "Edmonton", "ottawa", "winnipeg", "Hamilton", "kitchener",
  ],
  us: [
    "seattle", "Portland", "SanFrancisco", "LosAngeles", "Denver", "austin",
    "houston", "chicago", "Atlanta", "nyc", "boston", "phoenix",
  ],
  trades: [
    "HomeImprovement", "Renovations", "Construction", "Plumbing",
    "electricians", "HVAC", "Roofing", "landscaping",
  ],
};

const REGION = arg("region", "all");
const SUBS = arg("subs", null)
  ? arg("subs", "").split(",").map((s) => s.trim()).filter(Boolean)
  : REGION === "all"
    ? [...REGIONS.ca, ...REGIONS.us, ...REGIONS.trades]
    : (REGIONS[REGION] ?? []);

if (!SUBS.length) {
  console.log(`Unknown region "${REGION}". Known: ${Object.keys(REGIONS).join(", ")}, all\n`);
  process.exit(1);
}

/** The words people actually use. Nobody writes "seeking roofing services". */
const TRADE = [
  "roofer", "roofing", "roof leak", "plumber", "plumbing", "burst pipe",
  "electrician", "rewire", "electrical panel", "contractor", "renovation",
  "reno", "handyman", "landscaper", "landscaping", "painter", "drywall",
  "hvac", "furnace", "heat pump", "flooring", "tiler", "fence", "deck build",
];

/** What separates "I need one" from "here is my opinion about one". */
const INTENT = [
  "recommend", "recommendation", "looking for", "anyone know", "need a",
  "need an", "suggestions", "who do you use", "hire", "quote", "estimate",
  "help with", "any good", "worth it",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Reddit 429s an anonymous client quickly. One request every 1.5s stays under it. */
const PACE_MS = 1500;

function entries(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const block = m[1];
    const pick = (tag) => (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [, ""])[1];
    return {
      title: pick("title").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
      body: pick("content").replace(/<[^>]+>/g, " "),
      at: Date.parse(pick("updated")),
      url: (block.match(/<link[^>]*href="([^"]+)"/) ?? [, ""])[1],
    };
  });
}

const isRequest = (e) => {
  const text = `${e.title} ${e.body}`.toLowerCase();
  return TRADE.some((t) => text.includes(t)) && INTENT.some((i) => text.includes(i));
};

const hours = (ms) => ms / 3_600_000;

console.log(`\nReddit live flow · ${SUBS.length} subreddits · public feeds, no API key\n${"-".repeat(72)}`);
console.log(`${"subreddit".padEnd(20)} ${"posts".padStart(5)} ${"window".padStart(9)}  ${"hits".padStart(4)}`);
console.log("-".repeat(72));

const found = [];
let blocked = 0;
let totalDepth = 0;
let measured = 0;

for (const sub of SUBS) {
  let xml = "";
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/new.rss?limit=25`, {
      headers: { "User-Agent": UA, Accept: "application/atom+xml,text/xml,*/*" },
    });
    if (res.status === 429) {
      blocked++;
      console.log(`${sub.padEnd(20)} ${"—".padStart(5)} ${"rate limited".padStart(9)}`);
      await new Promise((r) => setTimeout(r, PACE_MS * 3));
      continue;
    }
    if (!res.ok) {
      console.log(`${sub.padEnd(20)} ${"—".padStart(5)} ${`HTTP ${res.status}`.padStart(9)}`);
      await new Promise((r) => setTimeout(r, PACE_MS));
      continue;
    }
    xml = await res.text();
  } catch (err) {
    console.log(`${sub.padEnd(20)} ${"—".padStart(5)} ${"unreachable".padStart(9)}  ${err.message}`);
    await new Promise((r) => setTimeout(r, PACE_MS));
    continue;
  }

  const list = entries(xml).filter((e) => Number.isFinite(e.at));
  const hits = list.filter(isRequest);
  hits.forEach((h) => found.push({ ...h, sub }));

  // The window the feed covers: oldest entry to newest. This is how long we
  // have to notice a post before it falls out of reach entirely.
  const depth = list.length > 1 ? hours(Math.max(...list.map((e) => e.at)) - Math.min(...list.map((e) => e.at))) : 0;
  if (depth > 0) {
    totalDepth += depth;
    measured++;
  }

  const window = depth >= 24 ? `${(depth / 24).toFixed(1)}d` : `${depth.toFixed(1)}h`;
  console.log(
    `${sub.padEnd(20)} ${String(list.length).padStart(5)} ${window.padStart(9)}  ${String(hits.length).padStart(4)}`
  );

  await new Promise((r) => setTimeout(r, PACE_MS));
}

console.log("-".repeat(72));

const avgDepth = measured ? totalDepth / measured : 0;

if (found.length) {
  console.log(`\n${found.length} live trade request${found.length === 1 ? "" : "s"} in view right now:\n`);
  for (const f of found.sort((a, b) => b.at - a.at).slice(0, 12)) {
    const age = hours(Date.now() - f.at);
    const when = age < 1 ? `${Math.round(age * 60)}m` : age < 48 ? `${Math.round(age)}h` : `${Math.round(age / 24)}d`;
    const title = f.title.length > 74 ? `${f.title.slice(0, 71)}…` : f.title;
    console.log(`  ${when.padStart(4)}  r/${f.sub.padEnd(18)} ${title}`);
  }
}

console.log(`\n${"=".repeat(72)}`);
console.log(`Feed window averages ${avgDepth.toFixed(1)}h across ${measured} subreddits.`);
if (blocked) console.log(`${blocked} subreddit${blocked === 1 ? " was" : "s were"} rate limited — rerun to cover ${blocked === 1 ? "it" : "them"}.`);
console.log(
  avgDepth > 0 && avgDepth < 6
    ? `\nThat is a narrow window. We would have to poll every few hours or lose posts\n` +
        `permanently, and a new signup arrives to an empty list — there is no history\n` +
        `in a feed. Live watching works; an instant backfill does not.`
    : `\nA window that wide means less frequent polling is safe, but it still holds no\n` +
        `history: everything older than the oldest entry above is unreachable from feeds.`
);
console.log(
  found.length >= 10
    ? `\n${found.length} requests visible in a single pass is real demand. The question is\n` +
        `only how a brand new customer sees any of it in their first minute.`
    : `\nOnly ${found.length} visible in one pass. Rerun a few times across a day before\n` +
        `concluding anything — one pass is one snapshot, not a rate.`
);
console.log("");
