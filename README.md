## Making Facebook / LinkedIn / Nextdoor / X work for hosted customers

The Vercel site cannot crawl those four. Reading them means driving a
signed-in Chrome profile, and a serverless function has no screen to log in
on, no installed browser, and no disk that survives the request. Reddit is
the exception — an app-only API token, no per-user login — which is why it is
the only platform the hosted site handles by itself.

So the work is split. **This machine crawls; Vercel scores.**

```
your PC                              Vercel
RUN-WORKER.bat every 4h              /api/cron/auto-scan hourly
  ↓ signed-in Chrome profiles          ↓ reads posts, never scrapes
  └──────────→ production Supabase ←───┘
                    ↓
              customer's dashboard on the live site
```

`scripts/auto-scrape.ts` writes into the same Supabase project the hosted app
reads, so posts crawled here appear in customers' dashboards on the live
site, and the hosted cron scores them there.

### Setting the worker up

1. `cp .env.worker.example .env.worker` and fill in the **production**
   Supabase URL and service-role key. Your normal `.env` is left alone, so
   local development keeps pointing wherever it already did.
2. Double-click `RUN-WORKER.bat` once to watch a run and confirm it connects.
3. Put it on a timer — Task Scheduler, every 4 hours:
   - Program/script: `cmd.exe`
   - Arguments: `/c "C:\path\to\RUN-WORKER.bat" /quiet`
   - Start in: the project folder

   `/quiet` drops the closing `pause` so a scheduled run exits on its own.
   Every run appends to `logs/worker.log`.

### What this does and does not fix

It fixes **collection**. Any account connected on this PC gets crawled on the
timer, for hosted customers as much as for you.

It does not fix **connecting**. `getAuthSessionPath(userId, platform)` keys
each Chrome profile to one customer's user id, so crawling a customer's
Facebook still requires that customer's account signed in *on this machine* —
somebody has to sit here and log in. A customer cannot self-serve Connect
Accounts from the website, and no amount of code changes that while the app
is on Vercel.

Sources whose owner has no session here are skipped by name in the log rather
than attempted, so it stays visible who is still waiting on a connection.
Without that check Playwright would create the missing profile directory,
scrape the logged-out wall, and mark the source freshly scraped — the run
would look successful and collect nothing.

The machine also has to be awake for a scheduled run to fire.

## Running the three local systems

Three apps share this machine, and they are all Next.js apps whose `dev`
script names no port — so unpinned, whichever one starts first takes 3000
and the others land wherever. Each one is pinned instead:

| Port | App |
| ---- | --- |
| 3000 | Pearl River hotel system |
| 3001 | Opportunity AI (this repo) |
| 3100 | VDN Logistics |

- `START.bat` — starts Opportunity AI on its own.
- `START-ALL.bat` — starts all three, each in its own window, and opens a
  tab for each. It skips any app that is already running, and installs
  dependencies on first run.

`START-ALL.bat` looks for the other two projects in folders next to this
one. If yours live somewhere else, copy `paths.local.example.cmd` to
`paths.local.cmd` and put the real paths in it — that file is gitignored,
since it describes your machine rather than the project.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
