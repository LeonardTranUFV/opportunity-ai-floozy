# Tasks: Opportunity AI

Shared board for Claude, Codex and Leo. One line per task:
`- [Owner] what — date — notes / evidence`. Owners: Claude, Codex, Leo.
Claim before you start; move to Done with the evidence.

## Doing

## Up next

## Done
- [Claude] Set up the Claude + Codex team files (AGENTS.md, CLAUDE.md, TASKS.md) — 2026-10-14
- [Claude] Bump next 16.3.8 → 16.4.5 (critical RCE advisories) and eslint-config-next to match — 2026-11-05 — next build 46/46 pages, tsc 0 errors, lint clean, npm run check 67/67, local dev pages/APIs same as before; npm audit --omit=dev 22 → 20, next no longer flagged. Live only after merge + deploy
- [Claude] Phase 1 of the shared-leads plan: one AI layer with fallbacks (lib/ai-provider.ts: Claude Code CLI → Codex CLI → Claude API Haiku 5.5 → Gemini) — 2026-11-05 — tsc 0, lint clean, npm run check 80/80 (13 new), next build 46/46; live run on made-up posts: Claude Code signed out → fell back to Codex, scored hiring ask 96 / job ad 0 / lost cat 0, drafted comment + DM. Claude API path UNPROVEN until ANTHROPIC_API_KEY is set
- [Claude] Phase 2 of the shared-leads plan: company profile and service areas (migration 0021) — 2026-11-05 — tsc 0, lint clean, npm run check 94/94 (14 new), next build 47/47; 0021 run twice on a throwaway Postgres (PGlite) with 0001: 19/19 (settings copied, RLS owner-only, clients cannot mark a group as Floozy, area delete cascades); form clicked through on a local preview page (trade, area, untick a city, signed-out save refused), no sideways scroll at 375 px. NOT applied to Supabase yet: Leo runs 0021 in the SQL editor, then npm run check:migrations
