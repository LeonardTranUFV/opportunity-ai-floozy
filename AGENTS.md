<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Claude + Codex team

Two AI agents work here for Leo (Floozy): **Claude** (Claude Code) leads, plans and checks the work; **Codex**
helps with images, second-opinion reviews and self-contained jobs Claude hands it. Leo normally talks to Claude.
Both read this file (Claude through `CLAUDE.md`, which imports it).

- `TASKS.md` is the shared board. Claim a task (owner + date) before starting; move it to Done with the
  evidence (test run, screenshot, file path). Never work on a task the other agent owns.
- Codex changes code in its own git worktree on a `codex/<task>` branch; Claude reviews and merges.
  Nobody switches branches, resets, stashes or reverts in Leo's main checkout.
- Never commit, revert or "clean up" changes you didn't make. Push or deploy only when Leo or Claude says so.
- Generated images go in `assets/generated/` unless the task says where, each with a same-name `.txt`
  holding the prompt, tool and date.
- Secrets live in `.env` / Vercel settings and are never printed, committed or sent anywhere.
- Report in plain English: what changed, which files, how you checked it, what is not verified.
