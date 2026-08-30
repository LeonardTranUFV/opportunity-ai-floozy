/**
 * Generate the trade photos for the auth panel, with Gemini's image model.
 *
 *   node scripts/generate-panel-photos.mjs
 *   node scripts/generate-panel-photos.mjs --only roofer
 *   node scripts/generate-panel-photos.mjs --model gemini-2.5-flash-image
 *   node scripts/generate-panel-photos.mjs --list        # what models this key can reach
 *
 * Needs GEMINI_API_KEY (or GOOGLE_API_KEY) in .env.local — the same key
 * lib/ai.ts already uses for scoring. Writes JPEGs into public/panel/.
 *
 * Two things worth knowing before running it.
 *
 * The model name moves. Google renames image models regularly and the one that
 * worked last quarter returns 404 this quarter, so `--list` prints every model
 * this key can actually reach and which ones can return an image. When the
 * default breaks, that is the fix — not a rewrite.
 *
 * And the prompts below deliberately avoid faces looking down a lens. A
 * generated portrait staring at camera is the single most recognisable "this
 * is AI" tell, and this photo appears on the one screen where a stranger is
 * deciding whether the product is real. Hands, tools, work in progress and
 * three-quarter turned figures survive that scrutiny; a smiling head-on
 * portrait does not.
 */
import { config } from "dotenv";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

config({ path: path.resolve(projectRoot, arg("env", ".env.local")) });

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.log(
    "\nGEMINI_API_KEY is not set.\n" +
      "Grab it from https://aistudio.google.com/apikey and put it in .env.local as\n" +
      "GEMINI_API_KEY=...  (the same key lib/ai.ts uses for scoring).\n"
  );
  process.exit(1);
}

const MODEL = arg("model", process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image");
const BASE = "https://generativelanguage.googleapis.com/v1beta";

if (has("list")) {
  const res = await fetch(`${BASE}/models?key=${apiKey}&pageSize=200`);
  const json = await res.json();
  const models = json.models ?? [];
  console.log(`\n${models.length} models reachable with this key:\n`);
  for (const m of models) {
    const name = m.name.replace("models/", "");
    const image = /image/i.test(name) ? "  ← can return images" : "";
    console.log(`  ${name}${image}`);
  }
  console.log("\nPass one with --model.\n");
  process.exit(0);
}

/**
 * One shot per trade, matching the rotation in components/auth/proof-panel.tsx.
 *
 * Every prompt names a real place, real weather and real light. Generated
 * images drift toward a glossy stock look when the prompt is generic, and a
 * contractor recognises stock instantly — the panel then argues against itself.
 */
const SHOTS = {
  roofer: {
    file: "roofer.jpg",
    prompt:
      "Documentary photograph, vertical. A roofer in his forties kneeling on an asphalt-shingle roof of a suburban British Columbia house, mid-repair, nail gun in hand, turned three-quarters away from camera. Overcast West Coast light after rain, wet shingles, cedar and fir in the background. Worn hi-vis vest, scuffed knee pads. Natural colour, slight grain, shot on a 35mm lens. No text, no logos, not looking at camera.",
  },
  painter: {
    file: "painter.jpg",
    prompt:
      "Documentary photograph, vertical. A painter cutting in along the edge of a ceiling in an empty suburban living room, brush in hand, seen from behind and slightly to the side. Bare floors, drop sheets, ladder, daylight through an uncurtained window. Paint-flecked clothes and hands. Natural colour, slight grain, 35mm. No text, no logos, face not toward camera.",
  },
  electrician: {
    file: "electrician.jpg",
    prompt:
      "Documentary photograph, vertical. An electrician's hands working inside an open residential breaker panel in a garage, headlamp light across the wiring, multimeter resting on a nearby step ladder. Close on the hands and panel, person mostly out of frame. Ordinary Canadian garage clutter behind. Natural colour, slight grain, 35mm. No text, no logos.",
  },
};

const only = arg("only");
const chosen = only ? { [only]: SHOTS[only] } : SHOTS;
if (only && !SHOTS[only]) {
  console.log(`Unknown shot "${only}". Known: ${Object.keys(SHOTS).join(", ")}\n`);
  process.exit(1);
}

const outDir = path.join(projectRoot, "public", "panel");
await mkdir(outDir, { recursive: true });

console.log(`\nModel: ${MODEL}\nWriting to public/panel/\n${"-".repeat(52)}`);

let wrote = 0;

for (const [name, shot] of Object.entries(chosen)) {
  process.stdout.write(`${name.padEnd(14)} `);

  const res = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: shot.prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
    console.log(`FAILED (${res.status})`);
    if (res.status === 404) {
      console.log(`   "${MODEL}" is not available to this key. Run with --list to see what is.`);
    } else {
      console.log(`   ${detail}`);
    }
    continue;
  }

  const json = await res.json();
  // The image comes back as base64 inline data among the response parts;
  // text parts are commentary and are ignored.
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData?.data)?.inlineData;

  if (!image) {
    const why = json?.candidates?.[0]?.finishReason ?? "no image in response";
    console.log(`NO IMAGE (${why})`);
    continue;
  }

  const file = path.join(outDir, shot.file);
  await writeFile(file, Buffer.from(image.data, "base64"));
  wrote++;
  console.log(`ok  →  public/panel/${shot.file}`);
}

console.log("-".repeat(52));
console.log(
  wrote
    ? `\n${wrote} image${wrote === 1 ? "" : "s"} written. Look at them before shipping — if a face\n` +
        `is staring down the lens or the scene looks like stock, rerun. The panel\n` +
        `exists to prove we are real, so a photo that reads as generated costs more\n` +
        `than no photo at all.\n`
    : `\nNothing written. Run with --list to see which models this key can reach.\n`
);
