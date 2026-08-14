# Launchers for the other two apps

`START.bat` in this repo starts Opportunity AI on port 3001. These two do the
same job for the other apps on the machine — they just live here because this
is the repo I have access to.

## Port map

| Port | App                      | Launcher                        |
| ---- | ------------------------ | ------------------------------- |
| 3000 | Pearl River hotel system | `START-PEARL-RIVER.bat`         |
| 3001 | Opportunity AI           | `START.bat` (this repo's root)  |
| 3100 | VDN Logistics            | `START-VDN.bat`                 |

One port per app, pinned. That's the whole point: a dev server that quietly
picks a different port when its own is busy is how you open one app and get
shown another.

## Install

Copy each file into that project's folder, next to its `package.json`:

- `START-PEARL-RIVER.bat` → the Pearl River project folder
- `START-VDN.bat` → the VDN Logistics project folder

Pearl River also needs `SETUP-PEARL-RIVER.bat` and `setup-local-db.mjs` in the
same folder, for the one-time database setup below.

Then double-click. Each script works out its own folder, so moving or renaming
the project won't break it. Right-click → *Send to* → *Desktop (create
shortcut)* if you want them one click away.

## What each one does

1. Checks it's actually in a project folder, and that Node is installed.
2. If the app is already listening on its port, just opens the browser — no
   second copy, no port collision.
3. Runs `npm install` on first use, when `node_modules` is missing.
4. Starts the dev server on its pinned port and opens the browser a few
   seconds later.
5. Keeps the window open if the server stops, so the error is readable.

## First run on a new machine

Both are Next.js + Prisma, and neither is clone-and-go — the launcher runs
`npm install` for you, but not the database step. On a laptop that has never
run them, do this once in each project folder before double-clicking:

**Pearl River** — it is **Postgres only**. `prisma/schema.prisma` is
`provider = "postgresql"` and `.env.example` carries only Supabase URLs, so a
clone will not start against a local file. Copy `SETUP-PEARL-RIVER.bat` **and**
`setup-local-db.mjs` into the project folder and double-click the `.bat` once.
It brings up Postgres 16 in Docker on port 5433, writes `.env`, pushes the
schema and seeds it. Docker Desktop is the only prerequisite.

Then give yourself the owner account, because the seed issues no credential to
anybody and every screen but `/book` and `/login` needs a signed-in staff
member:

```bash
node scripts/set-owner.mjs --password 'pick-something-real'
```

Sign in with `trantrithanhfilm@gmail.com` or the code `OWNER`. Ten characters
minimum — the script refuses shorter, since that account sees every guest
record.

After that first run, `START-PEARL-RIVER.bat` is all you need.

### Why local Postgres and not SQLite

It would be easier to add a SQLite fallback, and it would be wrong. Prisma
cannot take `provider` from an environment variable, so a fallback means two
schemas kept in step by hand — and SQLite rejects the `mode: "insensitive"`
flags the Supabase port added to all 38 `contains:` filters. The result is a
laptop that matches `nguyen` against `Nguyễn` and a production box that does
not, or the reverse. Nothing errors; there are simply fewer rows. That is the
exact failure the port was done carefully to avoid, and it should not be
reintroduced for the convenience of a demo.

Pointing `.env` at Supabase also works — `npm run db:setup` prompts for the
database password — but then the demo needs Singapore to be reachable. The
property is in Hai Phong, and Vietnam's international bandwidth rides a handful
of submarine cables that break several times a year. That is the same reasoning
that put VDN on a domestic VPS. Postgres 16 in a container is the same engine
as production, so collation and case behave identically, and it works with the
cable down.

**VDN Logistics** — copy `.env.example` to `.env`. `DATABASE_URL` already
points at a local SQLite file, so there is no database to install.
`SESSION_SECRET` is a placeholder and the app *throws on boot* if it isn't a
real value — that's deliberate, a default signing key would be a skeleton key.
Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then `npm run db:push`, `npm run db:seed`, and `npm run staff:password -- LEO`
to print yourself a password once. Changing `SESSION_SECRET` later signs
everyone out.

## If a project isn't Next.js

The scripts check `package.json` for `next` and pin the port with
`next dev -p`. Anything else falls through to `npm run dev` with `PORT` set.
Some tools ignore `PORT` (Vite wants `--port`), so if the app comes up on the
wrong port, edit the `else` branch near the bottom of the script to that
project's real command, e.g.:

```bat
call npm run dev -- --port %PORT%
```
