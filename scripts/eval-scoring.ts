/**
 * Golden-set eval for post scoring (lib/ai.ts → evaluatePostsForAgent).
 *
 *   npx tsx scripts/eval-scoring.ts                 # 3 runs, evals/scoring-golden.local.json
 *   npx tsx scripts/eval-scoring.ts --runs 1 --tag after-prompt-change
 *   npx tsx scripts/eval-scoring.ts --module /tmp/ai-old.ts --tag old   # an older lib/ai.ts, e.g. from `git show HEAD~1:lib/ai.ts`
 *
 * Why this exists: scoring is the one model call whose output a customer acts
 * on without reading the post first — the morning email takes every lead at 60+
 * and the HOT badge fires at 90+ or "asap". A prompt edit that looks harmless
 * can move hundreds of posts across those lines, and nothing in the app would
 * notice. This runs a fixed, hand-labelled set of real posts through the real
 * function and scores the *thresholds*, not the raw numbers:
 *
 *   not  → must come back not relevant
 *   weak → a real need but the wrong trade or too thin: not relevant, or under 60
 *   lead → relevant and 60+ (it has to reach the email)
 *   hot  → relevant and 90+ or "asap"
 *
 * Every run is repeated (default 3) because the same post can score 55 one call
 * and 70 the next; a prompt that is right on average but flips across the email
 * line is still wrong for the customer who gets the flip.
 *
 * The golden file holds real posts by members of the public, so it is
 * gitignored (evals/*.local.json) — see its "about" field for how it was built.
 * Costs one scoring call per agent per run on GEMINI_SCORING_MODEL.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;

config({ path: arg("--env", ".env.local") });

const goldenPath = arg("--golden", "evals/scoring-golden.local.json");
const runs = Number(arg("--runs", "3"));
const tag = arg("--tag", "run");

type Label = "not" | "weak" | "lead" | "hot";
interface GoldenCase {
  id: string;
  agent: string;
  platform: string;
  text: string;
  label: Label;
  why: string;
}
interface Verdict {
  relevant: boolean;
  score: number;
  urgency: string;
}

const EMAIL_LINE = 60; // lib/lead-digest.ts MIN_SCORE
const HOT_LINE = 90; // app/(app)/opportunities/page.tsx isHot

function passes(label: Label, v: Verdict): boolean {
  const isHot = v.relevant && (v.score >= HOT_LINE || v.urgency === "asap");
  switch (label) {
    case "not":
      return !v.relevant;
    case "weak":
      return !v.relevant || v.score < EMAIL_LINE;
    case "lead":
      return v.relevant && v.score >= EMAIL_LINE;
    case "hot":
      return isHot;
  }
}

async function main() {
  // Imported after dotenv so the key is in place when lib/ai.ts reads it.
  const modulePath = arg("--module", "");
  const { evaluatePostsForAgent } = (await import(
    modulePath ? pathToFileURL(path.resolve(modulePath)).href : "../lib/ai"
  )) as typeof import("../lib/ai");
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  const cases: GoldenCase[] = golden.cases;
  const byAgent = new Map<string, GoldenCase[]>();
  for (const c of cases) byAgent.set(c.agent, [...(byAgent.get(c.agent) ?? []), c]);

  const results: Record<string, Verdict[]> = Object.fromEntries(cases.map((c) => [c.id, []]));

  for (let r = 1; r <= runs; r++) {
    for (const [agentKey, list] of byAgent) {
      const a = golden.agents[agentKey];
      const verdicts = await evaluatePostsForAgent(
        { id: agentKey, name: a.name, goal: a.goal, location: a.location, keywords: a.keywords, negative_keywords: a.negative_keywords },
        list.map((c) => ({ post_id: c.id, platform: c.platform, author_name: "Member", raw_text: c.text, post_url: null, author_profile_url: null }))
      );
      list.forEach((c, i) => {
        const v = verdicts.find((x) => x?.index === i + 1) ?? verdicts[i];
        results[c.id].push(
          v ? { relevant: !!v.relevant, score: Number(v.intent_score) || 0, urgency: String(v.urgency) } : { relevant: false, score: -1, urgency: "missing" }
        );
      });
      // The free tier allows ~5 requests a minute per model; stay well under it.
      await new Promise((res) => setTimeout(res, 15000));
    }
    console.log(`run ${r}/${runs} done`);
  }

  // ---- report
  const perRunPass = Array.from({ length: runs }, (_, r) =>
    cases.filter((c) => passes(c.label, results[c.id][r])).length
  );
  const count = (pred: (c: GoldenCase, v: Verdict) => boolean) =>
    cases.reduce((n, c) => n + results[c.id].filter((v) => pred(c, v)).length, 0);
  const total = cases.length * runs;
  const falseLeads = count((c, v) => (c.label === "not" || c.label === "weak") && v.relevant && v.score >= EMAIL_LINE);
  const missedLeads = count((c, v) => (c.label === "lead" || c.label === "hot") && !(v.relevant && v.score >= EMAIL_LINE));
  const falseHot = count((c, v) => c.label !== "hot" && c.label !== "lead" && v.relevant && (v.score >= HOT_LINE || v.urgency === "asap"));
  const hotOnLeads = count((c, v) => c.label === "lead" && v.relevant && (v.score >= HOT_LINE || v.urgency === "asap"));
  const flips = cases.filter((c) => new Set(results[c.id].map((v) => passes(c.label, v))).size > 1);
  const spreads = cases
    .map((c) => results[c.id].filter((v) => v.relevant).map((v) => v.score))
    .filter((s) => s.length > 1)
    .map((s) => Math.max(...s) - Math.min(...s));
  const meanSpread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0;

  console.log(`\n${tag} — ${cases.length} cases × ${runs} runs`);
  console.log(`  pass per run:            ${perRunPass.map((p) => `${p}/${cases.length}`).join("  ")}`);
  console.log(`  false leads (not/weak ≥${EMAIL_LINE}): ${falseLeads}/${total} verdicts`);
  console.log(`  missed leads (lead/hot <${EMAIL_LINE}): ${missedLeads}/${total} verdicts`);
  console.log(`  HOT on not/weak posts:   ${falseHot}`);
  console.log(`  HOT on plain leads:      ${hotOnLeads} (allowed, but should be rare)`);
  console.log(`  cases that flip pass/fail between runs: ${flips.length}${flips.length ? ` (${flips.map((c) => c.id).join(", ")})` : ""}`);
  console.log(`  mean score spread across runs (relevant only): ${meanSpread.toFixed(1)} points`);
  console.log(`\n  failures:`);
  for (const c of cases) {
    const vs = results[c.id];
    if (vs.every((v) => passes(c.label, v))) continue;
    const shown = vs.map((v) => (v.relevant ? `${v.score}/${v.urgency}` : "not")).join(", ");
    console.log(`   ${c.id} [${c.agent}] expected ${c.label}: ${shown} — ${c.text.replace(/\s+/g, " ").slice(0, 90)}`);
  }

  fs.mkdirSync("evals/runs", { recursive: true });
  const out = path.join("evals/runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${tag}.json`);
  fs.writeFileSync(out, JSON.stringify({ tag, runs, model: process.env.GEMINI_SCORING_MODEL || "default", results }, null, 1));
  console.log(`\n  saved ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
