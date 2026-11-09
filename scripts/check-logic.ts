/**
 * Self-checks for the pure logic that the app can't exercise without a live
 * logged-in browser session.
 *
 *   npm run check
 *
 * These cover the pre-AI filter, the scraper's broken-selector canary, the
 * feed-JSON shape readers, and the adaptive throttle. All four decide things
 * that are invisible when they go wrong — a filter that drops real leads, a
 * canary that never fires, a shape reader that silently matches nothing —
 * which is exactly the class of bug worth pinning down with fixtures.
 *
 * Deliberately dependency-free: the project has no test runner, and adding one
 * to guard four pure functions would cost more than it returns.
 */
import { filterPostsForAgent, describeFilter, parseNegativePhrases } from "../lib/post-filter";
import { diagnosePlatform, type GroupOutcome } from "../lib/scraper";
import { extractPostsFromBodies } from "../lib/feed-capture";
import { DomainThrottle, classifyResponse, checkTarget } from "../lib/fetchers";
import { redactProviderSecrets } from "../lib/remote-browser";
import { scoreLead, WEAK_CAP } from "../lib/lead-score";
import { providerChain, readyProviders, extractJson, cooldownFor } from "../lib/ai-provider";
import { readFileSync } from "node:fs";
import { accountLabel, decideSwitch, openOperatorPass, sealOperatorPass, sortAccounts } from "../lib/account-switch";
import { sealStorageState } from "../lib/session-crypto";
import path from "node:path";
import { SERVICE_AREAS, areaSlug, areaForCity, choiceCovers, serviceAreaSeedSql } from "../lib/service-areas";
import { normalizeProfileInput, toBusinessProfile, isNotMigrated, EMPTY_PROFILE } from "../lib/company-profile";
import {
  floozyCollectorIds,
  collectSettings,
  pickDueGroups,
  apifyAllowance,
  utcDayStart,
  parseAreaGroupFile,
  collectPublicAreaGroups,
} from "../lib/floozy-collect";
import { isOffCloudByPolicy, withCloudPolicy } from "../lib/collection-mode";
import {
  matchSettings,
  parseClassification,
  placeOf,
  jobTerms,
  rankCandidates,
  matchAreaPosts,
  type Candidate,
} from "../lib/lead-matcher";

let failures = 0;
let checks = 0;
/** Checks that need to await something; the tally waits for them. */
const asyncChecks: Promise<void>[] = [];

function check(label: string, passed: boolean, detail?: string): void {
  checks++;
  if (!passed) failures++;
  console.log(`${passed ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------- pre-filter
section("lib/post-filter");
{
  const agent = { negative_keywords: "hiring roofer, roofing job, DIY roof, job" };

  check(
    "single-word negatives are not enforced locally",
    !parseNegativePhrases(agent.negative_keywords).includes("job"),
    "a bare word like 'job' would swallow real leads; only phrases are safe to match literally"
  );

  const posts = [
    { id: "keep-urgent", raw_text: "My roof is leaking badly after last night's storm, need someone asap in Burnaby" },
    { id: "keep-ask", raw_text: "Anyone recommend a good roofer? Getting quotes this week." },
    { id: "dupe-of-ask", raw_text: "Anyone   recommend a good ROOFER?  Getting quotes this week." },
    { id: "drop-hiring", raw_text: "Now hiring roofer for our crew, competitive pay, apply within today" },
    { id: "drop-price", raw_text: "CA$120" },
    { id: "drop-link", raw_text: "https://example.com/a/b/c/d/e/f/g" },
    { id: "keep-word-job", raw_text: "Need a big job done on my roof before winter, who do you all use?" },
  ];
  const r = filterPostsForAgent(agent, posts);
  const keptIds = r.kept.map((p) => p.id);

  check("keeps genuine asks", keptIds.includes("keep-urgent") && keptIds.includes("keep-ask"));
  check(
    "keeps a post containing an unenforced single-word negative",
    keptIds.includes("keep-word-job"),
    "'Need a big job done on my roof' must survive the 'job' negative"
  );
  check("drops a multi-word negative match", !keptIds.includes("drop-hiring"));
  check("drops text too short to read intent from", !keptIds.includes("drop-price"));
  check("drops a bare link with no prose", !keptIds.includes("drop-link"));
  check(
    "collapses a crosspost onto its twin",
    r.duplicates.get("keep-ask")?.some((p) => p.id === "dupe-of-ask") === true
  );
  check("summarises what it did", (describeFilter(r) ?? "").startsWith("Filtered out 4 posts"), describeFilter(r) ?? "no summary");
  check("empty input is inert", filterPostsForAgent(agent, []).kept.length === 0);
}

// -------------------------------------------------------------- canary logic
section("lib/scraper — diagnosePlatform");
{
  const g = (o: Partial<GroupOutcome>): GroupOutcome => ({
    name: "src",
    containers: 0,
    extracted: 0,
    capturedOnly: 0,
    behindJoinWall: false,
    loggedOut: false,
    extractionError: null,
    ...o,
  });
  const alerts = (o: GroupOutcome[]) => diagnosePlatform("facebook", o) !== null;

  check("stays quiet on a healthy run", !alerts([g({ containers: 30, extracted: 12 })]));
  check(
    "stays quiet when one source is empty but another works",
    !alerts([g({ containers: 30, extracted: 9 }), g({ containers: 18 })])
  );
  check("fires when no post blocks exist anywhere", alerts([g({ containers: 0 }), g({ containers: 0 })]));
  check("fires when blocks exist but none can be read", alerts([g({ containers: 25 }), g({ containers: 31 })]));
  check("fires when the extractor threw", alerts([g({ containers: 25, extractionError: "__name is not defined" })]));
  check("fires when signed out", alerts([g({ loggedOut: true })]));
  check("stays quiet when every source is just an unjoined group", !alerts([g({ behindJoinWall: true })]));
  check(
    "still fires when one source is unjoined and the other is dead",
    alerts([g({ behindJoinWall: true }), g({ containers: 12 })])
  );
  check(
    "reports the DOM failure even when JSON capture rescued the run",
    (diagnosePlatform("facebook", [g({ containers: 20, extracted: 0, capturedOnly: 14 })]) ?? "").includes(
      "nothing was lost"
    )
  );
}

// -------------------------------------------------------- feed shape readers
section("lib/feed-capture — shape readers");
{
  const fbBody =
    "for (;;);\n" +
    JSON.stringify({
      data: {
        node: {
          group_feed: {
            edges: [
              {
                node: {
                  comet_sections: {
                    content: {
                      story: {
                        post_id: "112233445566",
                        wwwURL: "https://www.facebook.com/groups/1/posts/112233445566/",
                        creation_time: 1754000000,
                        message: { text: "Our roof has been leaking since the storm, anyone know a good roofer in Burnaby?" },
                        actors: [{ name: "Dana W", url: "https://www.facebook.com/dana.w" }],
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    }) +
    "\n" +
    JSON.stringify({ data: { story: { message: { text: "nice" }, actors: [{ name: "X" }] } } });

  const fb = extractPostsFromBodies([fbBody], "facebook");
  check("facebook: finds the story node inside newline-delimited graphql", fb.posts.length === 1, `${fb.posts.length} found`);
  check("facebook: strips the for(;;); guard", fb.errors === 0);
  check("facebook: reads id, author and permalink", fb.posts[0]?.post_id === "fb_112233445566" && fb.posts[0]?.author_name === "Dana W");
  check("facebook: ignores text below the length floor", !fb.posts.some((p) => p.raw_text === "nice"));

  const liBody = JSON.stringify({
    included: [
      {
        entityUrn: "urn:li:activity:7100000000000000000",
        commentary: { text: { text: "We're hunting for a contractor to fit out our new Vancouver office in Q4." } },
        actor: { name: { text: "Priya N" }, navigationContext: { actionTarget: "https://www.linkedin.com/in/priya-n/" } },
      },
      { entityUrn: "urn:li:fs_profile:abc", firstName: "Not", lastName: "APost" },
    ],
  });
  const li = extractPostsFromBodies([liBody], "linkedin");
  check("linkedin: reads a voyager update and skips non-posts", li.posts.length === 1);
  check(
    "linkedin: rebuilds the activity permalink",
    li.posts[0]?.post_url === "https://www.linkedin.com/feed/update/urn:li:activity:7100000000000000000/"
  );

  const xBody = JSON.stringify({
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  {
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: "1800000000000000000",
                            legacy: {
                              id_str: "1800000000000000000",
                              full_text: "Anyone in Vancouver know a reliable plumber? Ours cancelled on us twice.",
                              created_at: "Wed Jul 30 14:22:11 +0000 2026",
                            },
                            core: { user_results: { result: { legacy: { screen_name: "vanhomeowner", name: "Chris L" } } } },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  });
  const x = extractPostsFromBodies([xBody], "twitter");
  check("x: reads a tweet out of a nested timeline", x.posts.length === 1);
  check("x: builds the status URL from handle + id", x.posts[0]?.post_url === "https://x.com/vanhomeowner/status/1800000000000000000");
  check("x: parses created_at into an ISO timestamp", (x.posts[0]?.timestamp ?? "").startsWith("2026-07-30T14:22:11"));

  const junk = ["", "not json", "{", '{"a":', "<html>403</html>", JSON.stringify({ deeply: { nested: { irrelevant: true } } })];
  let threw = false;
  let junkPosts = -1;
  try {
    junkPosts = extractPostsFromBodies(junk, "facebook").posts.length;
  } catch {
    threw = true;
  }
  check("garbage bodies yield nothing and never throw", !threw && junkPosts === 0);
  check("an unknown platform is inert", extractPostsFromBodies([fbBody], "nosuchplatform").posts.length === 0);
}

// ------------------------------------------------------------- throttle math
section("lib/fetchers — DomainThrottle");
{
  check("403 is treated as worth escalating to a browser", classifyResponse(403) === "blocked");
  check("429 is a pacing problem, not a block", classifyResponse(429) === "rate_limited");
  check("404 is neither", classifyResponse(404) === "error");
  check("200 is ok", classifyResponse(200) === "ok");

  const t = new DomainThrottle();
  const url = "https://www.reddit.com/r/vancouver/new.json";
  const start = t.delayFor(url);

  t.record(url, { verdict: "rate_limited", elapsedMs: 120 });
  const afterLimit = t.delayFor(url);
  check("a 429 backs the host off hard", afterLimit > start, `${start}ms -> ${afterLimit}ms`);

  for (let i = 0; i < 10; i++) t.record(url, { verdict: "ok", elapsedMs: 120 });
  const recovered = t.delayFor(url);
  check("a run of fast successes walks the delay back down", recovered < afterLimit, `${afterLimit}ms -> ${recovered}ms`);
  check("but never below the floor", recovered >= 400, `${recovered}ms`);

  for (let i = 0; i < 20; i++) t.record(url, { verdict: "blocked", elapsedMs: 50 });
  check("and never above the ceiling", t.delayFor(url) <= 30_000, `${t.delayFor(url)}ms`);

  const other = new DomainThrottle();
  other.record("https://a.example/x", { verdict: "blocked", elapsedMs: 10 });
  check(
    "hosts are throttled independently",
    other.delayFor("https://b.example/y") < other.delayFor("https://a.example/x")
  );
}

// --------------------------------------------------------------- SSRF guard
section("lib/fetchers — checkTarget (SSRF)");
{
  const refused = (u: string) => "error" in checkTarget(u);

  check("allows an ordinary public https URL", !refused("https://www.reddit.com/r/vancouver/new.json"));
  check("refuses cloud instance metadata", refused("http://169.254.169.254/latest/meta-data/"));
  check("refuses loopback by name", refused("http://localhost:3000/api/admin"));
  check("refuses loopback by address", refused("http://127.0.0.1/"));
  check("refuses IPv6 loopback", refused("http://[::1]/"));
  check("refuses RFC1918 10/8", refused("http://10.0.0.5/"));
  check("refuses RFC1918 192.168/16", refused("http://192.168.1.1/"));
  check("refuses RFC1918 172.16/12", refused("http://172.20.10.4/"));
  check("allows 172.32 which is outside the private range", !refused("http://172.32.0.1/"));
  check("refuses .local mDNS names", refused("http://printer.local/"));
  check("refuses non-http schemes", refused("file:///etc/passwd"));
  check("refuses garbage", refused("not a url"));
}

// ------------------------------------------- remote browser secret redaction
//
// Worth fixtures because this leak lives in the one path nobody exercises
// until something is already broken: an error handler. connectUrl carries the
// provider API key in its query string and Playwright echoes back the URL it
// could not reach, so an unredacted handler publishes that key into Vercel's
// logs and into the customer's own browser.
section("lib/remote-browser — redactProviderSecrets");
{
  const key = "bb_live_abc123DEF456";
  const connectUrl = `wss://connect.browserbase.com?apiKey=${key}&sessionId=abc`;
  const cleaned = redactProviderSecrets(`connect ECONNREFUSED ${connectUrl}`);

  check("strips the whole connect URL", !cleaned.includes("connect.browserbase.com"), cleaned);
  check("the key does not survive inside a URL", !cleaned.includes(key));
  check(
    "a bare key outside a URL is stripped too",
    !redactProviderSecrets(`auth failed for ${key}`).includes(key)
  );
  check(
    "https URLs are covered, not just wss",
    !redactProviderSecrets(`GET https://api.browserbase.com/v1/s?token=${key}`).includes(key)
  );
  check(
    "the provider's own error body still survives",
    redactProviderSecrets(
      'Browserbase POST /sessions failed (401): {"statusCode":401,"message":"Unauthorized"}'
    ).includes("Unauthorized"),
    "a misconfiguration has to stay diagnosable from the UI"
  );
  check(
    "ordinary text is left alone",
    redactProviderSecrets("That browser session has expired.") ===
      "That browser session has expired."
  );
}

// ---------------------------------------------------------------- lead score
section("lib/lead-score — scoreLead");
{
  const all = (n: number) => ({ need: n, fit: n, urgency: n, detail: n });

  check("straight 5s score 100", scoreLead(true, all(5)).intent_score === 100);
  check("straight 3s score 60, exactly the email line", scoreLead(true, all(3)).intent_score === 60);
  check(
    "a clear ask with a few days' urgency is HOT",
    scoreLead(true, { need: 5, fit: 5, urgency: 4, detail: 4 }).intent_score === 93
  );
  check(
    "a clear ask with normal timing is a lead, not HOT",
    scoreLead(true, { need: 5, fit: 5, urgency: 3, detail: 4 }).intent_score === 89
  );
  check(
    "rounds half up in integer arithmetic",
    // 5·35 + 4·30 + 3·20 + 2·15 = 385 → 77.0; 5·35 + 4·30 + 3·20 + 3·15 = 400 → 80
    scoreLead(true, { need: 5, fit: 4, urgency: 3, detail: 2 }).intent_score === 77 &&
      scoreLead(true, { need: 5, fit: 4, urgency: 3, detail: 3 }).intent_score === 80
  );
  check(
    "wrong trade is capped below the email line however clear the ask",
    scoreLead(true, { need: 5, fit: 2, urgency: 5, detail: 5 }).intent_score === WEAK_CAP
  );
  check(
    "a faint ask is capped below the email line",
    scoreLead(true, { need: 2, fit: 5, urgency: 3, detail: 3 }).intent_score === WEAK_CAP
  );
  check(
    "need 1 or fit 1 overrides the model's relevant=true",
    !scoreLead(true, { need: 1, fit: 5, urgency: 5, detail: 5 }).relevant &&
      !scoreLead(true, { need: 5, fit: 1, urgency: 5, detail: 5 }).relevant
  );
  check("relevant=false always scores 0", scoreLead(false, all(5)).intent_score === 0);
  check(
    "urgency labels map 5/4/3/2 → asap/high/medium/low",
    [5, 4, 3, 2].map((u) => scoreLead(true, { ...all(4), urgency: u }).urgency).join() ===
      "asap,high,medium,low"
  );
  check(
    "garbage ratings are clamped, not trusted",
    // 9 → 5, "4" → 4, -3 → 1, NaN → 1: 5·35 + 4·30 + 1·20 + 1·15 = 330 → 66
    scoreLead(true, { need: 9, fit: "4" as unknown as number, urgency: -3, detail: Number.NaN })
      .intent_score === 66
  );
}

// ---------------------------------------------------------------- ai provider
section("lib/ai-provider");
{
  check(
    "PC scoring tries the subscriptions first, then the API, then Gemini",
    providerChain("scoring", {}).join() === "claude-cli,codex-cli,claude-api,gemini"
  );
  check(
    "drafts start at the API even on the PC",
    providerChain("writing", {}).join() === "claude-api,gemini"
  );
  check(
    "Vercel never tries a local CLI, even when the chain names one",
    providerChain("scoring", { VERCEL: "1", AI_CHAIN_SCORING: "claude-cli,gemini" }).join() === "gemini"
  );
  check(
    "a job's own chain beats AI_CHAIN, and unknown names are dropped",
    providerChain("scoring", { AI_CHAIN: "gemini", AI_CHAIN_SCORING: "codex-cli, openai ,claude-api" }).join() ===
      "codex-cli,claude-api"
  );
  check(
    "only providers with a key or a CLI count as ready",
    readyProviders("writing", { VERCEL: "1", GEMINI_API_KEY: "x" }).join() === "gemini" &&
      readyProviders("writing", { VERCEL: "1" }).length === 0
  );
  check("plain JSON passes through", extractJson('{"a":1}') === '{"a":1}');
  check("a ```json fence is unwrapped", extractJson('```json\n[{"a":1}]\n```') === '[{"a":1}]');
  check("a sentence before the JSON is dropped", extractJson('Here you go: {"comment":"hi"}') === '{"comment":"hi"}');
  check("text with no JSON is rejected", extractJson("Sorry, I can't help with that.") === null);
  check("a cut-off array is rejected", extractJson('[{"index":0},{"ind') === null);
  check(
    "a signed-out CLI is paused for an hour",
    cooldownFor("claude-cli", "Claude Code: Failed to authenticate: OAuth session expired") === 60 * 60_000
  );
  check(
    "a CLI usage cap pauses it longer than an API rate limit",
    cooldownFor("codex-cli", "usage limit reached") > cooldownFor("claude-api", "429 rate limit")
  );
  check("an ordinary error does not pause a provider", cooldownFor("gemini", "answer was not JSON") === 0);
}

// ------------------------------------------------- service areas + profiles
section("lib/service-areas + lib/company-profile");
{
  check(
    "area slugs drop accents and punctuation",
    areaSlug("Greater Montréal") === "greater-montreal" && areaSlug("Washington, DC") === "washington-dc"
  );
  const ids = SERVICE_AREAS.map((a) => a.id);
  check("every area has its own slug", new Set(ids).size === ids.length, `${ids.length} areas`);
  const migration = readFileSync(
    path.join(__dirname, "..", "supabase", "migrations", "0021_company_profiles_and_areas.sql"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  check(
    "migration 0021 seeds exactly the areas in the code",
    migration.includes(`values\n${serviceAreaSeedSql()}\non conflict (id)`)
  );
  // If that one fails, lib/nearby-cities.ts changed: regenerate the seed with
  // serviceAreaSeedSql() and paste it into 0021 (or into a new migration once
  // 0021 is applied).
  check("a city finds its area", areaForCity("burnaby")?.id === "metro-vancouver");
  check(
    "a whole-area pick covers every city, a narrow pick only its own",
    choiceCovers({ areaId: "metro-vancouver", cities: [] }, "metro-vancouver", "Surrey") &&
      choiceCovers({ areaId: "metro-vancouver", cities: ["Burnaby"] }, "metro-vancouver", "burnaby") &&
      !choiceCovers({ areaId: "metro-vancouver", cities: ["Burnaby"] }, "metro-vancouver", "Surrey") &&
      !choiceCovers({ areaId: "metro-vancouver", cities: [] }, "fraser-valley", "Surrey")
  );

  const good = normalizeProfileInput({
    businessName: "  Test Roofing  ",
    yearsExperience: "12",
    trades: ["roofing", "roofing"],
    areas: [{ areaId: "metro-vancouver", cities: ["burnaby", "Surrey"] }],
  });
  check(
    "a profile is trimmed, de-duplicated and city names take the area's spelling",
    good.ok &&
      good.profile.businessName === "Test Roofing" &&
      good.profile.yearsExperience === 12 &&
      good.profile.trades.join() === "roofing" &&
      good.profile.areas[0].cities.join() === "Burnaby,Surrey"
  );
  const valley = SERVICE_AREAS.find((a) => a.id === "fraser-valley")!;
  const whole = normalizeProfileInput({ areas: [{ areaId: valley.id, cities: valley.cities }] });
  check("ticking every city saves as the whole area", whole.ok && whole.profile.areas[0].cities.length === 0);
  check("an unknown trade is refused", !normalizeProfileInput({ trades: ["astrology"] }).ok);
  check("an unknown area is refused", !normalizeProfileInput({ areas: [{ areaId: "atlantis", cities: [] }] }).ok);
  check(
    "a city outside the area is refused",
    !normalizeProfileInput({ areas: [{ areaId: "metro-vancouver", cities: ["Calgary"] }] }).ok
  );
  check(
    "more than 3 areas is refused",
    !normalizeProfileInput({ areas: SERVICE_AREAS.slice(0, 4).map((a) => ({ areaId: a.id, cities: [] })) }).ok
  );
  check(
    "years outside 0-100 or not whole are refused",
    !normalizeProfileInput({ yearsExperience: 150 }).ok && !normalizeProfileInput({ yearsExperience: 2.5 }).ok
  );
  const bp = toBusinessProfile({
    ...EMPTY_PROFILE,
    ownerName: "Leo",
    about: "Free quotes",
    yearsExperience: 10,
    services: "Re-roofs",
  });
  check(
    "the AI gets name, pitch, years and services, and nothing empty",
    bp.ownerName === "Leo" &&
      bp.businessName === undefined &&
      bp.pitch === "Free quotes. 10 years in the trade. Services: Re-roofs"
  );
  check(
    "a missing table or column reads as 'not migrated', a real error does not",
    isNotMigrated({ code: "PGRST205" }) &&
      isNotMigrated({ code: "42703" }) &&
      !isNotMigrated({ code: "23505", message: "duplicate key" }) &&
      !isNotMigrated(null)
  );
}

// ------------------------------------------------------ Floozy collection
section("lib/floozy-collect + cloud policy");
{
  const A = "00000000-0000-0000-0000-00000000000a";
  const B = "00000000-0000-0000-0000-00000000000b";
  check(
    "collector ids are trimmed, de-duplicated, and junk is dropped",
    floozyCollectorIds({ FLOOZY_COLLECTOR_USER_IDS: ` ${A}, nope ,${A.toUpperCase()},${B}` }).join() === `${A},${B}`
  );
  const s = collectSettings({ APIFY_DAILY_RESULTS: "abc", APIFY_RESULTS_PER_GROUP: "9999", FLOOZY_PC_GROUPS_PER_RUN: "" });
  check(
    "bad or out-of-range settings fall back or clamp",
    s.apifyDailyResults === 300 && s.apifyResultsPerGroup === 500 && s.pcGroupsPerRun === 6
  );
  const now = Date.parse("2026-11-05T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const due = pickDueGroups(
    [
      { id: "fresh", last_scraped_at: hoursAgo(1) },
      { id: "old", last_scraped_at: hoursAgo(30) },
      { id: "never", last_scraped_at: null },
      { id: "older", last_scraped_at: hoursAgo(50) },
    ],
    now,
    8 * 3_600_000,
    2
  );
  check("never-read groups go first, then the stalest, within the limit", due.map((g) => g.id).join() === "never,older");
  check(
    "the Apify allowance stops at the daily cap",
    apifyAllowance(0, 1000, 25) === 25 && apifyAllowance(990, 1000, 25) === 10 && apifyAllowance(1000, 1000, 25) === 0
  );
  check("the day starts at UTC midnight", utcDayStart(now) === "2026-11-05T00:00:00.000Z");

  const areaIds = new Set(SERVICE_AREAS.map((a) => a.id));
  const parsed = parseAreaGroupFile(
    [
      { url: "https://m.facebook.com/groups/123/?ref=x", area: "metro-vancouver", access: "public" },
      { url: "https://www.facebook.com/groups/123", area: "metro-vancouver", access: "private" },
      { url: "https://example.com/groups/1", area: "metro-vancouver", access: "public" },
      { url: "https://www.facebook.com/groups/456", area: "atlantis", access: "secret", collector: B },
    ],
    [A],
    areaIds
  );
  check(
    "an area-group file is cleaned and every problem is listed",
    parsed.groups.length === 1 &&
      parsed.groups[0].url === "https://www.facebook.com/groups/123" &&
      parsed.groups[0].collector === A &&
      parsed.problems.length === 5,
    parsed.problems.join(" | ")
  );

  check("the cloud reads Facebook unless CLOUD_FACEBOOK=off", !isOffCloudByPolicy("facebook", {}));
  check(
    "CLOUD_FACEBOOK=off keeps Facebook and Marketplace off the cloud, not Nextdoor",
    isOffCloudByPolicy("facebook", { CLOUD_FACEBOOK: "off" }) &&
      isOffCloudByPolicy("marketplace", { CLOUD_FACEBOOK: "OFF" }) &&
      !isOffCloudByPolicy("nextdoor", { CLOUD_FACEBOOK: "off" })
  );
  const merged = withCloudPolicy(new Set(["nextdoor"]), { CLOUD_FACEBOOK: "off" });
  check(
    "the policy adds to an account's own local platforms",
    merged !== "all" && merged !== null && merged.has("facebook") && merged.has("nextdoor") &&
      withCloudPolicy(null, {}) === null && withCloudPolicy("all", {}) === "all"
  );
}

asyncChecks.push(
  (async () => {
    // collectPublicAreaGroups against an in-memory database and a fake Apify.
    const A = "00000000-0000-0000-0000-00000000000a";
    type Row = Record<string, unknown>;
    const tables: Record<string, Row[]> = {
      collector_runs: [{ source: "apify", items: 990, started_at: new Date().toISOString() }],
      groups: [
        { id: "g1", user_id: A, platform: "facebook", name: "Pub 1", url: "https://www.facebook.com/groups/1", area_id: "metro-vancouver", last_scraped_at: null, owner_kind: "floozy", access: "public", active: true },
        { id: "g2", user_id: A, platform: "facebook", name: "Pub 2", url: "https://www.facebook.com/groups/2", area_id: "metro-vancouver", last_scraped_at: null, owner_kind: "floozy", access: "public", active: true },
        { id: "g3", user_id: A, platform: "facebook", name: "Private", url: "https://www.facebook.com/groups/3", area_id: "metro-vancouver", last_scraped_at: null, owner_kind: "floozy", access: "private", active: true },
      ],
      posts: [],
    };
    const fake = {
      from(table: string) {
        const filters: ((r: Row) => boolean)[] = [];
        let op = "select";
        let payload: unknown = null;
        let opts: { ignoreDuplicates?: boolean } = {};
        const b = {
          select: () => b,
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
          in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
          gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
          upsert: (rows: Row[], o: typeof opts) => ((op = "upsert"), (payload = rows), (opts = o ?? {}), b),
          update: (p: Row) => ((op = "update"), (payload = p), b),
          insert: (p: Row) => ((op = "insert"), (payload = p), b),
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            const t = (tables[table] ??= []);
            let out: unknown;
            if (op === "select") out = { data: t.filter((r) => filters.every((f) => f(r))), error: null };
            else if (op === "insert") {
              t.push(payload as Row);
              out = { error: null };
            }
            else if (op === "update") {
              t.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, payload));
              out = { error: null };
            } else {
              let count = 0;
              for (const row of payload as Row[]) {
                const hit = t.find((r) => r.user_id === row.user_id && r.external_post_id === row.external_post_id);
                if (!hit) {
                  t.push({ ...row });
                  count++;
                }
                else if (!opts.ignoreDuplicates) Object.assign(hit, row);
              }
              out = { error: null, count };
            }
            return Promise.resolve(out).then(resolve, reject);
          },
        };
        return b;
      },
    };

    const realFetch = globalThis.fetch;
    // lib/apify-scraper.ts reads the token from process.env itself.
    const realToken = process.env.APIFY_TOKEN;
    process.env.APIFY_TOKEN = "test";
    const asked: number[] = [];
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      const limit = JSON.parse(init?.body ?? "{}").resultsLimit as number;
      asked.push(limit);
      const items = Array.from({ length: limit }, (_, i) => ({
        postId: `p${asked.length}-${i}`,
        text: `Need a roofer ${i}`,
        user: { name: "Someone" },
        time: "2026-11-05T10:00:00Z",
      }));
      return new Response(JSON.stringify(items), { status: 200 });
    }) as typeof fetch;

    try {
      const res = await collectPublicAreaGroups(fake as never, {
        budgetMs: 600_000,
        env: { FLOOZY_COLLECTOR_USER_IDS: A, APIFY_TOKEN: "test", APIFY_DAILY_RESULTS: "1000", APIFY_RESULTS_PER_GROUP: "25" },
      });
      const g1 = tables.groups.find((g) => g.id === "g1")!;
      const g2 = tables.groups.find((g) => g.id === "g2")!;
      check(
        "Apify asks only for what is left of the daily cap, then stops",
        asked.join() === "10" && res.usedToday === 1000 && res.groupsRead === 1 && !g2.last_scraped_at,
        `asked ${asked.join()}, used ${res.usedToday}`
      );
      check(
        "area posts are stored under the collector, tagged with the area, and the read is logged",
        tables.posts.length === 10 &&
          tables.posts.every((p) => p.user_id === A && p.area_id === "metro-vancouver") &&
          !!g1.last_scraped_at &&
          tables.collector_runs.some((r) => r.group_id === "g1" && r.items === 10 && r.posts_new === 10)
      );
      check("private area groups are never sent to Apify", !tables.posts.some((p) => p.group_id === "g3"));
      const noToken = await collectPublicAreaGroups(fake as never, { budgetMs: 1000, env: { FLOOZY_COLLECTOR_USER_IDS: A } });
      check("without APIFY_TOKEN it says so and reads nothing", noToken.skipped === "APIFY_TOKEN is not set");
    } finally {
      globalThis.fetch = realFetch;
      if (realToken === undefined) delete process.env.APIFY_TOKEN;
      else process.env.APIFY_TOKEN = realToken;
    }
  })()
);

// ------------------------------------------------------------ lead matcher
section("lib/lead-matcher");
{
  check(
    "up to 5 clients per lead by default, never more than 10",
    matchSettings({}).maxClients === 5 &&
      matchSettings({ MATCH_MAX_CLIENTS: "10" }).maxClients === 10 &&
      matchSettings({ MATCH_MAX_CLIENTS: "40" }).maxClients === 10 &&
      matchSettings({}).minScore === 60
  );
  const cls = parseClassification(
    JSON.stringify({
      posts: [
        { index: 2, intent: "offer", trade: "roofing", city: null },
        { index: 1, intent: "request", trade: "roofing", city: " Burnaby " },
        { index: 3, intent: "request", trade: "astrology", city: null },
      ],
    }),
    4
  );
  check(
    "classification is read by index, an offer never carries a trade, unknown trades are dropped",
    cls[0]?.intent === "request" && cls[0]?.trade === "roofing" && cls[0]?.city === "Burnaby" &&
      cls[1]?.intent === "offer" && cls[1]?.trade === null &&
      cls[2]?.intent === "request" && cls[2]?.trade === null &&
      cls[3] === null
  );
  check("a garbled answer classifies nothing", parseClassification("not json", 2).every((c) => c === null));
  check(
    "a city in another area moves the lead there; an unknown city keeps the group's area",
    placeOf("metro-vancouver", "calgary").areaId === "calgary" &&
      placeOf("metro-vancouver", "calgary").city === "Calgary" &&
      placeOf("metro-vancouver", "Somewhere Small").areaId === "metro-vancouver" &&
      placeOf("metro-vancouver", null).areaId === "metro-vancouver"
  );
  check("job lists split on commas, 'and', 'or'", jobTerms("Leaks and storm damage, gutters; roofs or skylights").join("|") === "leaks|storm damage|gutters|roofs|skylights");

  const mk = (userId: string, over: Partial<Candidate> = {}): Candidate => ({
    userId,
    trades: ["roofing"],
    areas: [{ areaId: "metro-vancouver", cities: [] }],
    wantedJobs: "",
    unwantedJobs: "",
    recentLeads: 0,
    ...over,
  });
  const lead = { trade: "roofing", areaId: "metro-vancouver", city: "Burnaby", text: "Roof leak after the storm, need someone in Burnaby" };
  const ranked = rankCandidates(
    lead,
    [
      mk("a-busy", { recentLeads: 9 }),
      mk("b-plumber", { trades: ["plumbing"] }),
      mk("c-surrey-only", { areas: [{ areaId: "metro-vancouver", cities: ["Surrey"] }] }),
      mk("d-no-leaks", { unwantedJobs: "leak repairs, leak" }),
      mk("e-wants-storm", { wantedJobs: "storm damage, storm" }),
      mk("f-burnaby", { areas: [{ areaId: "metro-vancouver", cities: ["Burnaby"] }] }),
      mk("g-quiet", { recentLeads: 0 }),
      mk("h-calgary", { areas: [{ areaId: "calgary", cities: [] }] }),
    ],
    3
  );
  check(
    "fit: right trade and place only, 'never send' respected, wanted jobs then exact city then fewer recent leads",
    ranked.map((r) => r.userId).join() === "e-wants-storm,f-burnaby,g-quiet",
    ranked.map((r) => r.userId).join()
  );
  check("the note says why", ranked[0].note === 'Roofing in Burnaby, in your service area; matches "storm".');
  check(
    "never more clients than the cap",
    rankCandidates(lead, Array.from({ length: 12 }, (_, i) => mk(`u${String(i).padStart(2, "0")}`)), 5).length === 5
  );
}

asyncChecks.push(
  (async () => {
    // matchAreaPosts against an in-memory database, with fake AI calls.
    const COL = "00000000-0000-0000-0000-0000000000c0";
    const C1 = "00000000-0000-0000-0000-0000000000c1";
    const C2 = "00000000-0000-0000-0000-0000000000c2";
    type Row = Record<string, unknown>;
    const recent = new Date().toISOString();
    const floozyGroup = { name: "Burnaby neighbours", area_id: "metro-vancouver", owner_kind: "floozy" };
    const post = (id: string, text: string): Row => ({
      id, user_id: COL, group_id: "g1", platform: "facebook", post_url: `https://www.facebook.com/groups/1/posts/${id}`,
      author_name: "Someone", author_profile_url: null, posted_at: "2026-11-05T09:00:00Z", raw_text: text,
      area_id: "metro-vancouver", groups: floozyGroup, classified_at: null, scraped_at: recent,
    });
    const tables: Record<string, Row[]> = {
      company_profiles: [
        { user_id: C1, trades: ["roofing"], wanted_jobs: "", unwanted_jobs: "" },
        { user_id: C2, trades: ["plumbing"], wanted_jobs: "", unwanted_jobs: "" },
        { user_id: COL, trades: ["roofing"], wanted_jobs: "", unwanted_jobs: "" },
      ],
      client_service_areas: [
        { user_id: C1, area_id: "metro-vancouver", cities: [] },
        { user_id: C2, area_id: "metro-vancouver", cities: [] },
        { user_id: COL, area_id: "metro-vancouver", cities: [] },
      ],
      lead_matches: [],
      opportunities: [],
      credit_transactions: [],
      user_credits: [],
      subscriptions: [],
      posts: [
        post("p1", "Our roof is leaking in Burnaby, who do you recommend?"),
        post("p2", "Roofer here, free quotes this week!"),
        post("p3", "Lost cat near Metrotown"),
        { ...post("p4", "Need a roofer"), groups: { ...floozyGroup, owner_kind: "client" } },
      ],
    };
    let nextId = 1;
    const fake = {
      from(table: string) {
        const filters: ((r: Row) => boolean)[] = [];
        let op = "select";
        let payload: Row | Row[] | null = null;
        let wantRows = false;
        let single = false;
        let limit = Infinity;
        const b = {
          select: () => ((wantRows = true), b),
          eq: (c: string, v: unknown) =>
            (filters.push((r) => c.split(".").reduce<unknown>((o, k) => (o as Row | null)?.[k], r) === v), b),
          neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
          in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
          is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
          gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
          order: () => b,
          limit: (n: number) => ((limit = n), b),
          maybeSingle: () => ((single = true), b),
          single: () => ((single = true), b),
          update: (p: Row) => ((op = "update"), (payload = p), b),
          insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), b),
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            const t = (tables[table] ??= []);
            const hits = () => t.filter((r) => filters.every((f) => f(r)));
            let data: unknown = null;
            if (op === "select") data = hits().slice(0, limit);
            else if (op === "update") {
              const h = hits();
              h.forEach((r) => Object.assign(r, payload));
              data = h.map((r) => ({ id: r.id }));
            } else {
              const rows = (Array.isArray(payload) ? payload : [payload]) as Row[];
              const made = rows.map((r) => ({ id: `row${nextId++}`, ...r }));
              t.push(...made);
              data = made;
            }
            if (single) data = Array.isArray(data) ? (data[0] ?? null) : data;
            void wantRows;
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return b;
      },
    };

    let classifyCalls = 0;
    const scoredTrades: string[] = [];
    const res = await matchAreaPosts(fake as never, {
      budgetMs: 600_000,
      env: { FLOOZY_COLLECTOR_USER_IDS: COL },
      ai: {
        classify: async (_s, user) => {
          classifyCalls++;
          const n = (user.match(/### Post /g) ?? []).length;
          const answers = [
            { index: 1, intent: "request", trade: "roofing", city: "Burnaby" },
            { index: 2, intent: "offer", trade: "roofing", city: null },
            { index: 3, intent: "other", trade: null, city: null },
          ].slice(0, n);
          return JSON.stringify({ posts: answers });
        },
        score: async (agent, posts) => {
          scoredTrades.push(agent.name);
          return posts.map((_, i) => ({
            index: i + 1, relevant: true, intent_score: 88, urgency: "high" as const, estimated_value: "Unknown",
            ai_summary: "Roof leak in Burnaby", category: "Roofing", location_mentioned: "Burnaby", phone_number: null,
          }));
        },
      },
    });

    const opp = tables.opportunities;
    check(
      "a request is classified once, scored once, and lands only with the client in that trade",
      classifyCalls === 1 && scoredTrades.length === 1 && opp.length === 1 && opp[0].user_id === C1,
      `classify ${classifyCalls}, score ${scoredTrades.length}, opps ${opp.map((o) => o.user_id).join()}`
    );
    check(
      "the delivered lead carries the post's text, date, group and why",
      opp[0]?.source_kind === "floozy" && opp[0]?.agent_id === null && opp[0]?.source_group_name === "Burnaby neighbours" &&
        opp[0]?.source_posted_at === "2026-11-05T09:00:00Z" && opp[0]?.intent_score === 88 &&
        String(opp[0]?.match_note).startsWith("Roofing in Burnaby")
    );
    check(
      "the collector never receives its own leads, and the match is logged",
      !opp.some((o) => o.user_id === COL) &&
        tables.lead_matches.length === 1 && tables.lead_matches[0].post_id === "p1" && tables.lead_matches[0].rank === 1
    );
    check(
      "ads and chat are classified but not scored; posts from client groups are left alone",
      tables.posts.find((p) => p.id === "p2")?.intent === "offer" &&
        tables.posts.find((p) => p.id === "p3")?.intent === "other" &&
        tables.posts.find((p) => p.id === "p4")?.classified_at === null &&
        res.classified === 3 && res.leads === 1 && res.deliveries === 1
    );

    const again = await matchAreaPosts(fake as never, {
      budgetMs: 600_000,
      env: { FLOOZY_COLLECTOR_USER_IDS: COL },
      ai: { classify: async () => { classifyCalls++; return "{}"; }, score: async () => [] },
    });
    check("a second run finds nothing new and sends nothing twice", classifyCalls === 1 && again.deliveries === 0 && tables.opportunities.length === 1);

    const noClients = await matchAreaPosts(
      { from: (t: string) => fake.from(t === "company_profiles" ? "nobody" : t) } as never,
      { budgetMs: 1000, env: { FLOOZY_COLLECTOR_USER_IDS: COL } }
    );
    check("with no client set up it spends no AI at all", noClients.skipped === "no client has a trade and a service area yet");
  })()
);

section("operator account switcher");
{
  const savedKey = process.env.SESSION_ENCRYPTION_KEY;
  process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const OP = "operator-1";
  const CLIENT = "client-1";
  const NOW = 1_000_000;
  const pass = { operatorId: OP, viewingId: CLIENT, expiresAt: NOW + 1000 };
  const sealed = sealOperatorPass(pass);
  check("a pass opens back to what was sealed", JSON.stringify(openOperatorPass(sealed)) === JSON.stringify(pass));
  check("the pass doesn't show who it names", !Buffer.from(sealed, "base64url").toString("utf8").includes(OP));

  const raw = JSON.parse(Buffer.from(sealed, "base64url").toString("utf8"));
  const flipped = { ...raw, ciphertext: Buffer.from("tampered").toString("base64") };
  check("a tampered pass is refused", openOperatorPass(Buffer.from(JSON.stringify(flipped)).toString("base64url")) === null);
  const other = Buffer.from(JSON.stringify(sealStorageState({ cookies: [], operatorId: OP, viewingId: CLIENT, expiresAt: NOW + 1000 }))).toString("base64url");
  check("another sealed blob can't pose as a pass", openOperatorPass(other) === null);
  check("rubbish and an empty cookie are refused", openOperatorPass("not-a-pass") === null && openOperatorPass(undefined) === null);

  const base = {
    sessionUserId: OP,
    targetUserId: CLIENT,
    pass: null,
    sessionIsAdmin: true,
    passOperatorIsAdmin: false,
    targetIsAdmin: false,
    now: NOW,
  };
  const operatorOk = decideSwitch(base);
  check("an admin can switch into a client", operatorOk.ok && operatorOk.operatorId === OP);
  check("a client can't switch at all", !decideSwitch({ ...base, sessionUserId: CLIENT, targetUserId: "client-2", sessionIsAdmin: false }).ok);

  const inside = { ...base, sessionUserId: CLIENT, targetUserId: OP, pass, sessionIsAdmin: false, passOperatorIsAdmin: true, targetIsAdmin: true };
  const back = decideSwitch(inside);
  check("from a client account the operator can go back", back.ok && back.operatorId === OP);
  check("from a client account the operator can go to another client", decideSwitch({ ...inside, targetUserId: "client-2", targetIsAdmin: false }).ok);
  check("removing an operator from the allowlist ends switching", !decideSwitch({ ...inside, passOperatorIsAdmin: false }).ok);

  const expired = decideSwitch({ ...inside, now: pass.expiresAt });
  check("an expired pass is refused and says so", !expired.ok && expired.expired === true);
  check(
    "a leftover pass for another account gives no power",
    !decideSwitch({ ...inside, sessionUserId: "stranger", targetUserId: CLIENT, targetIsAdmin: false }).ok
  );
  const otherAdmin = decideSwitch({ ...base, targetUserId: "operator-2", targetIsAdmin: true });
  check("an operator can't go into another admin's account", !otherAdmin.ok && otherAdmin.status === 403);

  check("a business name wins over the email", accountLabel("a@b.c", " Acme ") === "Acme" && accountLabel("a@b.c", "  ") === "a@b.c");
  const sorted = sortAccounts([
    { id: "2", label: "Zed", email: "z", isOperator: false },
    { id: "3", label: "Abe", email: "a", isOperator: false },
    { id: "1", label: "Me", email: "m", isOperator: true },
  ]);
  check("my own account is listed first, then A to Z", sorted.map((a) => a.id).join() === "1,3,2");

  if (savedKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
  else process.env.SESSION_ENCRYPTION_KEY = savedKey;
}

Promise.all(asyncChecks)
  .catch((err) => check("async checks finished", false, err instanceof Error ? err.message : String(err)))
  .then(() => {
    console.log(
      `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed`
    );
    process.exit(failures === 0 ? 0 : 1);
  });
