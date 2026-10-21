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

let failures = 0;
let checks = 0;

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

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed`
);
process.exit(failures === 0 ? 0 : 1);
