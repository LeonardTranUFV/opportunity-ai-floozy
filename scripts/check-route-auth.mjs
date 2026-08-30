/**
 * Every API handler must fail closed.
 *
 * The check this replaces grepped each route *file* for `auth.getUser()`. A
 * file with a guarded POST and an unguarded GET passed, because the string was
 * present somewhere in it. Six handlers were sitting behind that blind spot,
 * including two DELETEs — one of which removes an agent and every opportunity
 * it ever found, addressed only by an id from the request body.
 *
 * Nothing was leaking: RLS policies scope every table to `auth.uid() = user_id`
 * and they are correct. But that made row-level security the *only* thing
 * standing between an anonymous request and other people's data, and one
 * `alter table ... disable row level security` during a migration would have
 * been enough. Handlers should not depend on a database setting to be safe.
 *
 * So this splits each file per exported handler and checks them one at a time.
 *
 *   node scripts/check-route-auth.mjs
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const files = globSync("app/api/**/route.ts");
const HANDLER = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
const GUARDS = ["auth.getUser()", "CRON_SECRET", "requireUser", "isAdmin("];

/**
 * A handler may be deliberately public — the free scan has to answer someone
 * who has never signed in. Such a handler declares `@public-route` inside its
 * own body.
 *
 * Two things keep this an exemption rather than a hole. It is matched per
 * handler, not per file, so it cannot silently cover a sibling DELETE. And
 * exempt handlers are printed on every run: a public route should stay visible
 * and get re-justified each time someone reads this output, not vanish from
 * the report.
 *
 * A public handler still owes the reader the other two locks — a rate limit,
 * and returning only columns that are safe to hand a stranger.
 */
const PUBLIC_MARKER = "@public-route";

let guarded = 0;
const unguarded = [];
const publicRoutes = [];

for (const file of files.sort()) {
  const src = readFileSync(file, "utf8");
  const marks = [...src.matchAll(HANDLER)].map((m) => ({ at: m.index, verb: m[1] }));

  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : src.length;
    const block = src.slice(marks[i].at, end);
    const where = `${marks[i].verb.padEnd(6)} ${file}`;

    if (GUARDS.some((g) => block.includes(g))) guarded++;
    else if (block.includes(PUBLIC_MARKER)) publicRoutes.push(where);
    else unguarded.push(where);
  }
}

console.log(`handlers checked : ${guarded + unguarded.length + publicRoutes.length}`);
console.log(`guarded          : ${guarded}`);
console.log(`public on purpose: ${publicRoutes.length}`);
for (const p of publicRoutes) console.log("   ", p);
console.log(`UNGUARDED        : ${unguarded.length}`);
for (const u of unguarded) console.log("   ", u);

if (unguarded.length > 0) {
  console.log(
    "\nEvery handler needs its own session check. RLS is the second lock, not the first." +
      `\nA handler that must answer anonymous callers declares ${PUBLIC_MARKER} in its body.`
  );
  process.exit(1);
}
console.log("\nAll handlers fail closed, or say why they don't.");
