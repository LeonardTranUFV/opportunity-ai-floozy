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

## If a project isn't Next.js

The scripts check `package.json` for `next` and pin the port with
`next dev -p`. Anything else falls through to `npm run dev` with `PORT` set.
Some tools ignore `PORT` (Vite wants `--port`), so if the app comes up on the
wrong port, edit the `else` branch near the bottom of the script to that
project's real command, e.g.:

```bat
call npm run dev -- --port %PORT%
```
