import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

/**
 * One way in for every AI call in the app, with fallbacks.
 *
 * Each job lists the providers to try, in order. A provider that is not set
 * up here (no key, no CLI, or we are on Vercel and it is a local CLI) is
 * skipped without a call. One that fails, or answers with something that is
 * not JSON, hands the same prompt to the next. So the PC worker can score on
 * Leo's Claude Code or Codex login first, fall back to the Claude API when a
 * usage cap hits, and fall back again to Gemini, with no change to callers.
 *
 *   AI_CHAIN_SCORING   e.g. "claude-cli,codex-cli,claude-api,gemini"
 *   AI_CHAIN_WRITING   e.g. "claude-api,gemini"
 *   AI_CHAIN           used for any job without its own list
 *
 * Defaults: on Vercel the CLIs cannot exist, so both jobs start at the API.
 * Anywhere else (the PC worker, local dev) scoring tries the subscriptions
 * first. Writing (comments and DMs a client will send) stays on the API so
 * its quality does not depend on which login happens to have room left.
 */

export type AiJob = "scoring" | "writing";
export type ProviderName = "claude-cli" | "codex-cli" | "claude-api" | "gemini";

export interface AiCallResult {
  /** The model's answer: text that JSON.parse accepts. */
  text: string;
  provider: ProviderName;
  model: string;
  ms: number;
}

const ALL_PROVIDERS: ProviderName[] = ["claude-cli", "codex-cli", "claude-api", "gemini"];
const LOCAL_ONLY: ProviderName[] = ["claude-cli", "codex-cli"];

type Env = Record<string, string | undefined>;

function onVercel(env: Env): boolean {
  return Boolean(env.VERCEL);
}

/** The order to try providers in for one job, before availability checks. */
export function providerChain(job: AiJob, env: Env = process.env): ProviderName[] {
  const raw =
    (job === "scoring" ? env.AI_CHAIN_SCORING : env.AI_CHAIN_WRITING) ??
    env.AI_CHAIN ??
    defaultChain(job, env);

  const seen = new Set<ProviderName>();
  for (const name of raw.split(",").map((s) => s.trim().toLowerCase())) {
    if (!(ALL_PROVIDERS as string[]).includes(name)) continue;
    const provider = name as ProviderName;
    if (onVercel(env) && LOCAL_ONLY.includes(provider)) continue;
    seen.add(provider);
  }
  return [...seen];
}

function defaultChain(job: AiJob, env: Env): string {
  if (onVercel(env) || job === "writing") return "claude-api,gemini";
  return "claude-cli,codex-cli,claude-api,gemini";
}

/**
 * Pull the JSON out of a model's answer. Models asked for "JSON only" still
 * sometimes wrap it in a ```json fence or add a sentence before it; Gemini's
 * JSON mode never does, the others occasionally do. Returns null when there
 * is no parseable object or array in the text.
 */
export function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (isParseable(trimmed)) return trimmed;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && isParseable(fence[1].trim())) return fence[1].trim();

  // Only the kind of bracket the JSON opens with. Trying both would turn a
  // cut-off array like `[{"index":0},{"ind` into its first object, and a
  // scoring batch would then silently come back with no verdicts.
  const objectAt = trimmed.indexOf("{");
  const arrayAt = trimmed.indexOf("[");
  if (objectAt === -1 && arrayAt === -1) return null;
  const isArray = arrayAt !== -1 && (objectAt === -1 || arrayAt < objectAt);
  const start = isArray ? arrayAt : objectAt;
  const end = trimmed.lastIndexOf(isArray ? "]" : "}");
  if (end <= start) return null;
  const candidate = trimmed.slice(start, end + 1);
  return isParseable(candidate) ? candidate : null;
}

function isParseable(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const JSON_ONLY = "\n\nReply with the JSON only: no prose before or after it, no markdown fences.";

// ------------------------------------------------------------------ cooldowns
//
// A provider that just told us it is out of room (usage cap, rate limit,
// signed out, not installed) is skipped for a while instead of being asked
// again for every batch of a scan.

const cooldownUntil = new Map<ProviderName, number>();

function coolingDown(provider: ProviderName): boolean {
  const until = cooldownUntil.get(provider);
  return until !== undefined && until > Date.now();
}

function coolDown(provider: ProviderName, ms: number): void {
  cooldownUntil.set(provider, Date.now() + ms);
}

const MINUTE = 60_000;

/** How long to skip a provider after this error, or 0 to keep trying it. */
export function cooldownFor(provider: ProviderName, message: string): number {
  const m = message.toLowerCase();
  if (m.includes("enoent") || m.includes("is not recognized as") || m.includes("command not found")) {
    return 24 * 60 * MINUTE;
  }
  if (/(authenticate|oauth|logged in|login|sign in|unauthori[sz]ed|401|api key)/.test(m)) return 60 * MINUTE;
  if (/(usage limit|limit reached|rate limit|quota|credit|429|overloaded|529)/.test(m)) {
    return LOCAL_ONLY.includes(provider) ? 30 * MINUTE : 2 * MINUTE;
  }
  return 0;
}

// ------------------------------------------------------------------ providers

interface Provider {
  available(env: Env): boolean;
  model(job: AiJob, env: Env): string;
  call(job: AiJob, system: string, user: string, model: string): Promise<string>;
}

const PROVIDERS: Record<ProviderName, Provider> = {
  "claude-cli": {
    available: (env) => !onVercel(env),
    model: (_job, env) => env.CLAUDE_CLI_MODEL || "haiku",
    call: callClaudeCli,
  },
  "codex-cli": {
    available: (env) => !onVercel(env),
    model: (_job, env) => env.CODEX_CLI_MODEL || "default",
    call: callCodexCli,
  },
  "claude-api": {
    available: (env) => Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    model: (job, env) =>
      job === "scoring"
        ? env.CLAUDE_SCORING_MODEL || "claude-haiku-5-5"
        : env.CLAUDE_WRITING_MODEL || "claude-haiku-5-5",
    call: callClaudeApi,
  },
  gemini: {
    available: (env) => Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY),
    model: (job, env) =>
      job === "scoring"
        ? env.GEMINI_SCORING_MODEL || "gemini-3.1-flash-lite"
        : env.GEMINI_WRITING_MODEL || "gemini-3.6-flash",
    call: callGemini,
  },
};

/**
 * The providers that could serve this job here, in chain order. A local CLI
 * counts as set up even if it turns out to be signed out; callAI then falls
 * through to the next one. Empty means the job cannot run at all.
 */
export function readyProviders(job: AiJob, env: Env = process.env): ProviderName[] {
  return providerChain(job, env).filter((name) => PROVIDERS[name].available(env));
}

/**
 * Run one AI job through the provider chain. Returns the first answer that
 * parses as JSON. Throws only when every provider was skipped or failed, with
 * each one's reason in the message.
 */
export async function callAI(job: AiJob, system: string, user: string): Promise<AiCallResult> {
  const env = process.env;
  const reasons: string[] = [];

  for (const name of providerChain(job, env)) {
    const provider = PROVIDERS[name];
    if (!provider.available(env)) {
      reasons.push(`${name}: not set up`);
      continue;
    }
    if (coolingDown(name)) {
      reasons.push(`${name}: paused after an earlier error`);
      continue;
    }

    const model = provider.model(job, env);
    const started = Date.now();
    try {
      const raw = await provider.call(job, system, user, model);
      const json = extractJson(raw);
      if (json === null) throw new Error(`answer was not JSON: ${raw.slice(0, 160)}`);
      const ms = Date.now() - started;
      console.info(`[ai] ${job} via ${name} (${model}) in ${ms}ms`);
      return { text: json, provider: name, model, ms };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const pause = cooldownFor(name, message);
      if (pause > 0) coolDown(name, pause);
      reasons.push(`${name}: ${message.slice(0, 200)}`);
      console.warn(`[ai] ${job} via ${name} failed, trying the next provider: ${message.slice(0, 200)}`);
    }
  }

  throw new Error(`No AI provider could run the ${job} job. ${reasons.join(" | ") || "The chain is empty."}`);
}

// ---- Claude Code CLI (Leo's Claude login, PC only)

const CLI_TIMEOUT_MS = 5 * MINUTE;

async function callClaudeCli(job: AiJob, system: string, user: string, model: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "oai-claude-"));
  try {
    const systemFile = path.join(dir, "system.txt");
    await writeFile(systemFile, system + JSON_ONLY, "utf8");
    const stdout = await run(
      "claude",
      [
        "-p",
        "--output-format", "json",
        "--model", model,
        "--system-prompt-file", systemFile,
        // No tools, no MCP servers, no skills, no saved session: one plain
        // answer, and nothing in the post text can make it act.
        "--tools", "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--setting-sources", "project",
        "--effort", job === "scoring" ? "low" : "medium",
      ],
      user,
      dir
    );
    const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: string };
    if (envelope.is_error || typeof envelope.result !== "string") {
      throw new Error(`Claude Code: ${envelope.result ?? "no result"}`);
    }
    return envelope.result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---- Codex CLI (Leo's ChatGPT login, PC only)

async function callCodexCli(_job: AiJob, system: string, user: string, model: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "oai-codex-"));
  try {
    const outFile = path.join(dir, "answer.txt");
    const args = ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-C", dir, "-o", outFile];
    if (model !== "default") args.push("-m", model);
    args.push("-");
    await run("codex", args, `${system}${JSON_ONLY}\n\n---\n\n${user}`, dir);
    return await readFile(outFile, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Run a CLI with the prompt on stdin. Both CLIs are npm shims (.cmd) on
 * Windows, which only start through a shell, so there the command line is
 * built here: every argument is a flag, a model name or a temp path we made,
 * never text from a post, and each is quoted. The prompt itself only ever
 * travels on stdin.
 */
function run(command: string, args: string[], stdin: string, cwd: string): Promise<string> {
  const windows = process.platform === "win32";

  return new Promise((resolve, reject) => {
    if (windows && args.some((a) => /["%^&|<>]/.test(a))) {
      reject(new Error(`${command}: refusing an argument with shell characters`));
      return;
    }
    const child = windows
      ? spawn([command, ...args.map((a) => `"${a}"`)].join(" "), { cwd, shell: true, windowsHide: true })
      : spawn(command, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${CLI_TIMEOUT_MS / 1000}s`));
    }, CLI_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Claude Code exits 1 on an API or login error but still prints its
      // JSON envelope, which says why; let the caller read it.
      if (code === 0 || (command === "claude" && stdout.trim().startsWith("{"))) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${(stderr || stdout).trim().slice(-300)}`));
    });
    child.stdin.end(stdin);
  });
}

// ---- Claude API (the API credit; works on Vercel and the PC)

let anthropic: Anthropic | null = null;

async function callClaudeApi(job: AiJob, system: string, user: string, model: string): Promise<string> {
  anthropic ??= new Anthropic();
  // Streamed so a 100-post scoring batch can never hit the HTTP timeout;
  // finalMessage() hands back the whole answer.
  const stream = anthropic.messages.stream({
    model,
    max_tokens: job === "scoring" ? 32000 : 8000,
    output_config: { effort: job === "scoring" ? "low" : "medium" },
    // The instructions are the same for every batch of a scan, so they are
    // cached: later batches pay about a tenth for them.
    system: [{ type: "text", text: system + JSON_ONLY, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") throw new Error("Claude declined this request");
  if (message.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off at max_tokens");

  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

// ---- Gemini (moved here unchanged from lib/ai.ts)

const GEMINI_RETRYABLE = new Set([503, 500]);
const GEMINI_ATTEMPTS = 3;
const GEMINI_RETRY_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gemini sometimes reports finishReason "STOP" while cutting the JSON off
// mid-string (about 1 in 2 calls in one test batch), unrelated to
// maxOutputTokens. Retrying here, once, centrally, turns that into either a
// clean parse or a clear error instead of garbled text shown as a draft.
async function callGemini(_job: AiJob, system: string, user: string, model: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= GEMINI_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: user }] }],
        systemInstruction: { parts: [{ text: system }] },
        // Set explicitly: some clients default well below the real 65,536
        // cap, which would truncate the JSON array on large batches.
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 65536 },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) lastError = new Error("Gemini API returned no content");
      else if (!isParseable(text)) lastError = new Error(`Gemini API returned malformed JSON: ${text.slice(0, 200)}`);
      else return text;

      if (attempt < GEMINI_ATTEMPTS) {
        await sleep(GEMINI_RETRY_DELAY_MS * attempt);
        continue;
      }
      throw lastError;
    }

    // The key is in the URL, so the error text is read but never the URL.
    const errText = await response.text();
    lastError = new Error(`Gemini API error (${response.status}): ${errText.slice(0, 300)}`);
    // Only transient overload is retried, not quota (429) or bad requests.
    if (!(GEMINI_RETRYABLE.has(response.status) && attempt < GEMINI_ATTEMPTS)) throw lastError;
    await sleep(GEMINI_RETRY_DELAY_MS * attempt);
  }

  throw lastError ?? new Error("Gemini API request failed");
}
