/**
 * Measure the skeptic pass (lib/lead-skeptic.ts) before switching it on.
 *
 * The question it answers: of the leads the skeptic would kill, how many
 * really were weak — and how many good leads would it wrongly take out of a
 * contractor's morning email? Run it before SKEPTIC_MODE=on, and again after
 * any change to the skeptic prompt.
 *
 *   # A. the hand-labelled golden set (the same file eval-scoring.ts uses):
 *   #    scores every post, then runs the skeptic on the ones at 60+.
 *   npx tsx scripts/eval-skeptic.ts --golden evals/scoring-golden.local.json --env .env.worker
 *
 *   # B. a sample of real leads already in the database (READ ONLY):
 *   #    runs the skeptic on N recent leads at 60+ and writes a labelling sheet.
 *   npx tsx scripts/eval-skeptic.ts --from-db --sample 60 --env .env.worker
 *   #    then fill in "label" ("good" / "weak") in the sheet and re-read it —
 *   #    no AI calls the second time, the verdicts are already in the sheet:
 *   npx tsx scripts/eval-skeptic.ts --labels evals/skeptic-sample.local.json
 *
 * Ground truth for B, before anyone labels by hand: the owner's own pipeline
 * status. "lost" is a lead they rejected; contacted / qualified / appointment
 * / proposal / won are leads they acted on. "new" says nothing and is left for
 * a hand label.
 *
 * Costs: A is two scoring-model calls per agent; B is one per 100 leads. B
 * never writes to the database. Both sheets hold real posts by members of the
 * public, so they are gitignored (evals/*.local.json, evals/runs/) — the
 * repository is public.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";

const argv = process.argv.slice(2);
const has = (name: string) => argv.includes(name);
const arg = (name: string, fallback: string) => (has(name) ? argv[argv.indexOf(name) + 1] : fallback);

config({ path: arg("--env", ".env.local") });

type Truth = "good" | "weak";
interface SheetRow {
  id: string;
  agent: string;
  platform: string;
  posted_at: string | null;
  score: number;
  text: string;
  status?: string;
  verdict: "keep" | "reject" | "unchecked";
  code: string | null;
  reason: string;
  /** Ground truth: from the golden label, the owner's status, or a hand label. */
  label: Truth | null;
  label_source: "golden" | "status" | "hand" | null;
}

const ACTED_ON = new Set(["contacted", "qualified", "appointment", "proposal", "won"]);
const SHEET = arg("--out", "evals/skeptic-sample.local.json");

async function fromGolden(goldenPath: string): Promise<SheetRow[]> {
  const { evaluatePostsForAgent, skepticCheckLeads } = await import("../lib/ai");
  const { needsSkeptic } = await import("../lib/lead-skeptic");
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  const rows: SheetRow[] = [];
  const byAgent = new Map<string, { id: string; platform: string; text: string; label: string }[]>();
  for (const c of golden.cases) byAgent.set(c.agent, [...(byAgent.get(c.agent) ?? []), c]);

  for (const [key, cases] of byAgent) {
    const a = golden.agents[key];
    const agent = { id: key, name: a.name, goal: a.goal, location: a.location, keywords: a.keywords, negative_keywords: a.negative_keywords };
    const scored = await evaluatePostsForAgent(
      agent,
      cases.map((c) => ({ post_id: c.id, platform: c.platform, author_name: "Member", raw_text: c.text, post_url: null, author_profile_url: null }))
    );
    await pause();
    const passed = cases
      .map((c, i) => ({ c, v: scored.find((x) => x?.index === i + 1) ?? scored[i] }))
      .filter(({ v }) => v?.relevant && needsSkeptic(v.intent_score));
    if (passed.length === 0) continue;
    const verdicts = await skepticCheckLeads(
      agent,
      passed.map(({ c, v }) => ({ platform: c.platform, text: c.text, posted_at: null, location_mentioned: v.location_mentioned, ai_summary: v.ai_summary }))
    );
    await pause();
    passed.forEach(({ c, v }, j) => {
      const s = verdicts[j];
      rows.push({
        id: c.id,
        agent: key,
        platform: c.platform,
        posted_at: null,
        score: v.intent_score,
        text: c.text,
        verdict: s?.verdict ?? "unchecked",
        code: s?.code ?? null,
        reason: s?.reason ?? "",
        label: c.label === "lead" || c.label === "hot" ? "good" : "weak",
        label_source: "golden",
      });
    });
  }
  return rows;
}

async function fromDb(sample: number): Promise<SheetRow[]> {
  const { createClient } = await import("@supabase/supabase-js");
  const { skepticCheckLeads } = await import("../lib/ai");
  const { MIN_SCORE } = await import("../lib/lead-score");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from the env file");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Reads only. Newest leads that could have reached an email, with the
  // owner's status, so acted-on and rejected leads label themselves.
  let q = sb
    .from("opportunities")
    .select("id,agent_id,platform,content,intent_score,status,location_mentioned,ai_summary,posts:source_post_id(posted_at)")
    .gte("intent_score", MIN_SCORE)
    .order("created_at", { ascending: false })
    .limit(sample);
  if (has("--user")) q = q.eq("user_id", arg("--user", ""));
  const { data: opps, error } = await q;
  if (error) throw new Error(error.message);

  const agentIds = [...new Set((opps ?? []).map((o) => o.agent_id).filter(Boolean))] as string[];
  const { data: agents, error: aErr } = await sb
    .from("agents")
    .select("id,name,goal,location,keywords,negative_keywords")
    .in("id", agentIds);
  if (aErr) throw new Error(aErr.message);

  const rows: SheetRow[] = [];
  for (const agent of agents ?? []) {
    const list = (opps ?? []).filter((o) => o.agent_id === agent.id);
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const postedAt = (o: (typeof chunk)[number]) =>
        ((o.posts as unknown as { posted_at: string | null } | null)?.posted_at ?? null);
      const verdicts = await skepticCheckLeads(
        agent,
        chunk.map((o) => ({ platform: o.platform ?? "", text: o.content ?? "", posted_at: postedAt(o), location_mentioned: o.location_mentioned, ai_summary: o.ai_summary ?? "" }))
      );
      await pause();
      chunk.forEach((o, j) => {
        const s = verdicts[j];
        const label: Truth | null = o.status === "lost" ? "weak" : ACTED_ON.has(o.status) ? "good" : null;
        rows.push({
          id: o.id,
          agent: agent.name,
          platform: o.platform ?? "",
          posted_at: postedAt(o),
          score: o.intent_score ?? 0,
          text: o.content ?? "",
          status: o.status,
          verdict: s?.verdict ?? "unchecked",
          code: s?.code ?? null,
          reason: s?.reason ?? "",
          label,
          label_source: label ? "status" : null,
        });
      });
    }
  }
  return rows;
}

/** The free tier allows ~5 requests a minute per model; stay well under it. */
const pause = () => new Promise((res) => setTimeout(res, Number(arg("--pause-ms", "15000"))));

function report(rows: SheetRow[], tag: string): string {
  const labelled = rows.filter((r) => r.label);
  const killed = labelled.filter((r) => r.verdict === "reject");
  const rightKills = killed.filter((r) => r.label === "weak");
  const wrongKills = killed.filter((r) => r.label === "good");
  const good = labelled.filter((r) => r.label === "good");
  const weak = labelled.filter((r) => r.label === "weak");
  const missedWeak = weak.filter((r) => r.verdict !== "reject");
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
  const byCode = new Map<string, number>();
  for (const r of rows.filter((r) => r.verdict === "reject")) byCode.set(r.code ?? "?", (byCode.get(r.code ?? "?") ?? 0) + 1);

  const lines = [
    `${tag} — ${rows.length} leads at 60+, ${labelled.length} with a label, ${rows.filter((r) => r.verdict === "unchecked").length} unchecked (call failed or skipped)`,
    `  rejected by the skeptic:       ${rows.filter((r) => r.verdict === "reject").length}/${rows.length}`,
    `  precision (kills truly weak):  ${rightKills.length}/${killed.length} = ${pct(rightKills.length, killed.length)}`,
    `  good leads wrongly killed:     ${wrongKills.length}/${good.length} = ${pct(wrongKills.length, good.length)}`,
    `  weak leads it caught (recall): ${weak.length - missedWeak.length}/${weak.length} = ${pct(weak.length - missedWeak.length, weak.length)}`,
    `  morning email before → after:  ${rows.length} → ${rows.length - rows.filter((r) => r.verdict === "reject").length} leads`,
    `  rejections by reason:          ${[...byCode].map(([c, n]) => `${c} ${n}`).join(", ") || "none"}`,
    ``,
    `  good leads it killed (the expensive mistake):`,
    ...wrongKills.map((r) => `   ${r.id} [${r.agent}] ${r.code}: ${r.reason} — ${r.text.replace(/\s+/g, " ").slice(0, 90)}`),
    ...(wrongKills.length ? [] : ["   none"]),
  ];
  return lines.join("\n");
}

async function main() {
  let rows: SheetRow[];
  let tag: string;
  if (has("--labels")) {
    const file = arg("--labels", SHEET);
    rows = (JSON.parse(fs.readFileSync(file, "utf8")).rows as SheetRow[]).map((r) => ({
      ...r,
      label_source: r.label && !r.label_source ? "hand" : r.label_source,
    }));
    tag = `labels ${path.basename(file)}`;
  } else if (has("--from-db")) {
    rows = await fromDb(Number(arg("--sample", "60")));
    tag = `db sample of ${rows.length}`;
    fs.mkdirSync(path.dirname(SHEET), { recursive: true });
    fs.writeFileSync(SHEET, JSON.stringify({ about: "Skeptic verdicts on real leads. Fill label: good/weak for rows with label null, then run with --labels.", rows }, null, 1));
    console.log(`labelling sheet written to ${SHEET}`);
  } else {
    rows = await fromGolden(arg("--golden", "evals/scoring-golden.local.json"));
    tag = "golden set";
  }

  const text = report(rows, tag);
  console.log(`\n${text}`);
  fs.mkdirSync("evals/runs", { recursive: true });
  const out = path.join("evals/runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-skeptic.txt`);
  fs.writeFileSync(out, text + "\n");
  console.log(`\n  saved ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
