/**
 * Is the Browserbase configuration actually valid?
 *
 *   node scripts/check-browserbase.mjs                 # reads .env.worker
 *   node scripts/check-browserbase.mjs --env .env      # or another file
 *   BROWSERBASE_API_KEY=... node scripts/check-browserbase.mjs
 *
 * Exists because the alternative loop is brutal: paste a key into Vercel,
 * redeploy, click Connect, read a 401, guess again — five minutes per attempt,
 * and the failure looks identical whether the key is wrong, truncated, or
 * carrying a stray space. The first real connect attempt in production failed
 * exactly this way, on a key copied from a masked field.
 *
 * Uses GET /v1/sessions, which authenticates without creating a browser, so
 * running this costs nothing. Never prints the key — only its length and
 * shape, which is enough to spot the usual damage.
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

const flag = process.argv.indexOf("--env");
const envFile = flag !== -1 ? process.argv[flag + 1] : ".env.worker";
config({ path: path.resolve(projectRoot, envFile) });

const key = process.env.BROWSERBASE_API_KEY;
const project = process.env.BROWSERBASE_PROJECT_ID;

console.log(`credentials from ${envFile} (plus any already in the environment)\n`);

let problems = 0;
const bad = (msg) => {
  problems++;
  console.log(` FAIL  ${msg}`);
};
const ok = (msg) => console.log(`  ok   ${msg}`);

if (!key) {
  bad("BROWSERBASE_API_KEY is not set");
} else {
  ok(`BROWSERBASE_API_KEY is set — ${key.length} chars, starts "${key.slice(0, 8)}"`);

  // The three ways a hand-copied key arrives broken, each of which produces an
  // identical 401 from the API and so is invisible without checking here.
  if (key.includes("*")) bad("it contains '*' — this is the MASKED value, not the real key. Reveal it (eye icon) before copying");
  if (key !== key.trim()) bad("it has leading or trailing whitespace — re-copy without the surrounding spaces/newline");
  if (!key.startsWith("bb_")) bad(`it does not start with "bb_" — is this the Project ID, or the encryption key, by mistake?`);
}

if (!project) {
  bad("BROWSERBASE_PROJECT_ID is not set");
} else {
  ok(`BROWSERBASE_PROJECT_ID is set — "${project}"`);
  if (project.startsWith("bb_")) bad("the Project ID looks like an API key — these two got swapped");
  if (!/^[0-9a-f-]{36}$/i.test(project)) bad("the Project ID is not a 36-character UUID");
}

if (!key) {
  console.log("\nNothing to test against the API without a key.");
  process.exit(1);
}

// Authenticates without creating a session, so this is free to run.
let res;
try {
  res = await fetch("https://api.browserbase.com/v1/sessions?limit=1", {
    headers: { "X-BB-API-Key": key },
    signal: AbortSignal.timeout(20_000),
  });
} catch (err) {
  console.log(`\n FAIL  could not reach Browserbase: ${err.message}`);
  process.exit(1);
}

const body = await res.text().catch(() => "");

if (res.status === 200) {
  ok("Browserbase accepted the key (GET /v1/sessions returned 200)");
  console.log("\nPASS — this key works. Paste this exact value into Vercel as BROWSERBASE_API_KEY, then redeploy.");
  process.exit(problems === 0 ? 0 : 1);
}

if (res.status === 401) {
  console.log(`\n FAIL  Browserbase rejected the key (401): ${body.slice(0, 200)}`);
  console.log(
    "\nThe key is not valid. Most likely it was copied from the masked field.\n" +
      "In Browserbase → Settings → General, click the EYE icon next to the API key\n" +
      "to reveal it, select the text by hand, copy that, and try again."
  );
  process.exit(1);
}

console.log(`\n FAIL  unexpected response ${res.status}: ${body.slice(0, 200)}`);
process.exit(1);
