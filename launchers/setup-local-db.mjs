/**
 * Pearl River — local Postgres for a laptop.
 *
 *   node setup-local-db.mjs
 *
 * Brings up Postgres 16 in Docker, writes `.env` at it, pushes the schema and
 * seeds it. Run it from the Pearl River project folder, or double-click
 * SETUP-PEARL-RIVER.bat which does that for you.
 *
 * Why local Postgres rather than the two easier options:
 *
 * SQLite is not available any more and should not be brought back. Prisma
 * cannot take `provider` from an env var, so a fallback means two schemas —
 * and SQLite rejects the `mode: "insensitive"` flags the Supabase port added
 * to every `contains:` filter. You would get a laptop that matches `nguyen`
 * against `Nguyễn` and a production box that does not. That silent divergence
 * is the whole reason the port was done carefully.
 *
 * Pointing at Supabase works, but then the demo needs Singapore to be
 * reachable. The property is in Hai Phong and Vietnam's international links go
 * down several times a year — the same reasoning that put VDN on a VPS.
 *
 * Postgres 16 in a container is the same engine as production, so collation
 * and case behave identically, and it survives the cable being cut.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// 5433, not 5432. A laptop that already has Postgres installed is holding the
// default port, and the failure mode there is the one this whole branch is
// about: two databases, one port, and an app quietly talking to the wrong one.
const PORT = 5433;
const CONTAINER = "pearl-river-db";
const VOLUME = "pearl-river-pgdata";
const DB = "pearlriver";
const IMAGE = "postgres:16";

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, ".env");

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", shell: true, ...opts });
}

function step(msg) {
  console.log(`\n  ${msg}`);
}

function die(msg) {
  console.error(`\n  [X] ${msg}\n`);
  process.exit(1);
}

// ── Sanity: are we in the right folder? ──────────────────────────────────────
if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  die(
    "No package.json here.\n" +
      "      Put this file in the Pearl River project folder and run it there."
  );
}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
if (pkg.name !== "pearl-river-hotel-system") {
  die(`This is "${pkg.name}", not pearl-river-hotel-system.`);
}

// set-owner.mjs and set-pins.mjs import src/lib/hash.ts directly, so they need
// a Node that strips types. Failing here beats failing later with a stack trace
// about an unexpected token in a .ts file.
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  console.warn(
    `\n  [!] Node ${process.versions.node}. The scripts that issue credentials import a\n` +
      `      TypeScript file directly and need Node 22 or newer. Setup will still run.`
  );
}

// ── Docker ───────────────────────────────────────────────────────────────────
if (run("docker", ["version", "--format", "{{.Server.Version}}"]).status !== 0) {
  die(
    "Docker isn't running, or isn't installed.\n\n" +
      "      Install Docker Desktop from https://docker.com and start it, then\n" +
      "      run this again. It is the only thing this needs.\n\n" +
      "      Or, if you have the Supabase database password and don't mind the\n" +
      "      demo needing the internet:  npm run db:setup"
  );
}

// ── Work out the password ────────────────────────────────────────────────────
//
// The container keeps the password it was created with, so on a second run the
// only copy that matches is the one already in .env. Generating a fresh one
// would write an .env that cannot open the database sitting next to it.
const existingEnv = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
const known = existingEnv.match(
  new RegExp(`postgresql://postgres:([^@]+)@localhost:${PORT}/`)
);

const exists =
  run("docker", ["ps", "-a", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Names}}"])
    .stdout.trim() === CONTAINER;

if (exists && !known) {
  die(
    `The container "${CONTAINER}" already exists, but .env has no password for it,\n` +
      "      so there is no way to reach it. Either restore the .env you had, or\n" +
      `      throw the database away and start clean:\n\n` +
      `        docker rm -f ${CONTAINER} && docker volume rm ${VOLUME}`
  );
}

// Hex only, deliberately: this string is passed through a shell to docker and
// written into a URL, and hex needs no escaping in either.
const password = known ? known[1] : randomBytes(16).toString("hex");
const url = `postgresql://postgres:${password}@localhost:${PORT}/${DB}`;

// ── Start it ─────────────────────────────────────────────────────────────────
let fresh = false;

if (!exists) {
  step(`Creating Postgres ${IMAGE.split(":")[1]} on port ${PORT}...`);
  const created = run("docker", [
    "run", "-d",
    "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${password}`,
    "-e", `POSTGRES_DB=${DB}`,
    "-p", `${PORT}:5432`,
    "-v", `${VOLUME}:/var/lib/postgresql/data`,
    IMAGE,
  ]);
  if (created.status !== 0) die(`Docker could not start it:\n\n${created.stderr.trim()}`);
  fresh = true;
} else {
  const running =
    run("docker", ["ps", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Names}}"])
      .stdout.trim() === CONTAINER;
  if (running) {
    step("Postgres is already running.");
  } else {
    step("Starting the existing Postgres...");
    const started = run("docker", ["start", CONTAINER]);
    if (started.status !== 0) die(`Could not start it:\n\n${started.stderr.trim()}`);
  }
}

// Postgres accepts the port before it accepts connections, and on first run it
// initialises the data directory first. Pushing the schema into that gap fails
// with a connection error that reads like a wrong password.
step("Waiting for it to accept connections...");
let ready = false;
for (let i = 0; i < 60; i++) {
  if (run("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres", "-d", DB]).status === 0) {
    ready = true;
    break;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}
if (!ready) die(`Postgres never came up. Look at:  docker logs ${CONTAINER}`);

// ── .env ─────────────────────────────────────────────────────────────────────
//
// Values stay double-quoted: set-owner.mjs and set-pins.mjs parse this file
// themselves with /^(\w+)="(.*)"$/ and skip any line that is not quoted.
//
// DIRECT_URL is the same URL as DATABASE_URL here. They differ on Supabase
// because the pooler cannot carry DDL; there is no pooler in front of this one.
function upsert(text, key, value) {
  const line = `${key}="${value}"`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
}

let env = existingEnv;
env = upsert(env, "DATABASE_URL", url);
env = upsert(env, "DIRECT_URL", url);
fs.writeFileSync(ENV_FILE, env.trimStart());
step(existingEnv ? "Updated .env." : "Wrote .env.");

// ── Dependencies, schema, data ───────────────────────────────────────────────
if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
  step("Installing dependencies - this takes a few minutes...");
  if (run("npm", ["install"], { stdio: "inherit" }).status !== 0) die("npm install failed.");
}

step("Creating the tables...");
if (run("npm", ["run", "db:push"], { stdio: "inherit" }).status !== 0) {
  die("db:push failed. The message above says why.");
}

// Only on a database we just created. Re-running the seed duplicates every row,
// and there is no way to tell from here whether the rows came from the seed or
// from an afternoon of somebody using the system.
if (fresh) {
  step("Seeding the property, its 269 units and its trading history...");
  if (run("npm", ["run", "db:seed"], { stdio: "inherit" }).status !== 0) {
    die("db:seed failed. The message above says why.");
  }
}

// ── What's left ──────────────────────────────────────────────────────────────
console.log(`
  ----------------------------------------------------------------
  Postgres is up on localhost:${PORT} and the schema is in place.

  One thing left. Every screen except /book and /login needs a
  signed-in staff member, and the seed issues no credential to
  anybody - so right now nothing can sign in. Give yourself the
  owner account (10 characters minimum):

    node scripts/set-owner.mjs --password 'pick-something-real'

  Then sign in at http://localhost:3000/login with
  trantrithanhfilm@gmail.com, or the code OWNER.

  Start the app by double-clicking START-PEARL-RIVER.bat.

  The database keeps running in the background and survives a
  reboot. To stop it:  docker stop ${CONTAINER}
  ----------------------------------------------------------------
`);
