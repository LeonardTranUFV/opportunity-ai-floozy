# Security — audit + pre-launch checklist

**Last full audit: 2026-08-04.** Re-run everything in Part 2 before each launch.

---

# Part 1 — Audit results (2026-08-04)

## Verified clean

| Check | Method | Result |
|---|---|---|
| Hardcoded secrets in source | `git grep` for key/token/password patterns across all tracked files | **None** |
| Secrets in git history | `git log --all -p` scanned for key shapes | **None** — never committed, so no history rewrite needed |
| `.env` committed | `git ls-files` | **Not tracked**, and in `.gitignore` |
| Secrets exposed to browser | Audited every `NEXT_PUBLIC_*` var | Only `SUPABASE_URL` + `ANON_KEY` — both **designed** to be public |
| Service-role key leakage | Checked every file importing `lib/supabase/admin` for `"use client"` | **Server-only.** This is the critical one — that key bypasses RLS entirely |
| API route auth | All 23 routes checked for `auth.getUser()` | **All gated.** Only exception is the cron route, which uses `CRON_SECRET` (correct) |

## Multi-tenant isolation — tested, not assumed

"RLS is enabled" proves nothing; a permissive policy passes that check. These were run against live production data with the **public anon key**, i.e. exactly what a browser can do:

| Attack | Result |
|---|---|
| Logged-out read of all 7 tables | **Blocked** |
| Authenticated user reading another account's rows | **Blocked** |
| Authenticated user *writing* to another account's rows | **0 rows affected** |
| Deep link `?id=<uuid>` to someone else's record | **Blocked** — query runs as the caller, RLS filters it |

Ground truth: the admin key sees 5 `settings` rows across 2 users; a signed-in user sees only their own 4.

## Fixed in this pass

1. **SSRF in `/api/tools/website-scan`** — it fetched an arbitrary user-supplied URL server-side with no restriction. Could have been aimed at `127.0.0.1`, `169.254.169.254` (cloud metadata) or internal hosts. Now rejects non-`http(s)` schemes plus loopback, link-local and RFC1918 ranges.
2. **No rate limiting anywhere.** Added on every route that costs money or drives a browser.
3. **No input validation.** Added body-size caps, JSON shape checks, string length caps, control-character stripping.
4. **Auth limits too loose** — sign-ups/sign-ins were 30 per 5 min per IP (360/hr). Now **5 per 5 min (60/hr)**.

## Known limitations — accepted, not hidden

- **Rate limiting is per-process.** On Vercel each serverless instance keeps its own counters, so a determined attacker hitting N instances gets N× the limit. It's a real brake on runaway cost and casual abuse, **not a hard boundary**. Durable fix = shared store (Postgres table or Upstash Redis); deferred because it needs a migration and migrations here are hand-pasted.
- **Auth rate limit is per-IP and shared.** 5/5min covers sign-ups *and* sign-ins together. Office/NAT users share that budget, and it counts your own testing. If legitimate users get locked out, raise it — this is a tuning dial, not a fixed truth.
- **CSP `script-src` allows `'unsafe-inline'`.** Next injects inline bootstrap
  scripts on every page; locking them down needs a per-request nonce in
  middleware, which makes every page dynamic. React escapes what it renders and
  this app renders no user-supplied HTML, so the injection surface is small —
  and `default-src 'self'` still stops an injected script from loading or
  exfiltrating off-origin, which is the step that turns an XSS into a breach.
- **GitHub repo is Public.** No secrets in it, but all source and business logic is visible to competitors. Business decision, still open.
- **No error monitoring.** Runtime errors in production are invisible unless a user reports them.

---

# Part 2 — Pre-launch checklist

Run all of it. Takes ~10 minutes.

## 1. Secrets

```bash
# No hardcoded secrets in tracked files
git grep -nIE "(api[_-]?key|secret|token|password|bearer)\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}" -- . ':!*.md' ':!package-lock.json'

# Nothing secret ever committed
git log --all -p -- ':!*.md' | grep -nE "^\+.*(AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{30,}|service_role.*eyJ)"

# .env not tracked
git ls-files | grep -E "^\.env|/\.env"

# Only URL + ANON_KEY should appear
git grep -ohE "NEXT_PUBLIC_[A-Z_]+" -- '*.ts' '*.tsx' | sort -u
```
All four should return **nothing** (except the last, which should list only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

## 2. Service-role key is server-only

```bash
for f in $(git grep -l "supabase/admin" -- '*.ts' '*.tsx'); do
  head -1 "$f" | grep -q "use client" && echo "LEAK: $f"
done
```
Any output here is a **critical** finding — stop and fix.

## 3. Every API handler is authenticated

```bash
node scripts/check-route-auth.mjs
```
Exits non-zero and names any handler without its own session check.

> **This check used to be wrong, and it mattered.** It grepped each route
> *file* for `auth.getUser()`, so a file with a guarded `POST` and an unguarded
> `GET` passed — the string was present somewhere in it. Six handlers were
> hiding in that blind spot, including two `DELETE`s, one of which removes an
> agent and every opportunity it ever found, addressed only by an id from the
> request body.
>
> Nothing was leaking: the RLS policies scope every table to
> `auth.uid() = user_id` and they are correct. But that made row-level security
> the *only* thing between an anonymous request and other people's data, and a
> single `disable row level security` during a migration would have been enough.
> A per-file grep cannot see this. A per-handler check can.

## 4. Tenant isolation still holds

Run the live isolation test (logged-out read / cross-account read / cross-account write). Any row returned that isn't the caller's own is a **critical** finding. See Part 1 for the shape of the test.

## 5. Rate limits

- Supabase → Auth → Rate Limits → **sign-ups and sign-ins ≤ 5 per 5 min**
- Any new API route that calls Gemini, spends credits, or launches Playwright **must** call `rateLimit(...)` — grep for new routes missing it.

## 6. Input validation

Every new POST route uses `readJsonBody()` (not raw `request.json()`) and validates fields with `str()` / `httpUrl()`.

## 7. Build + deploy

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```

## 8. Live smoke test

- Sign up with a real address, click the emailed link **from a phone** (different browser — this is the exact case the PKCE bug broke)
- Log in, log out, reset password
- Load dashboard / opportunities / settings — no console errors

## 9. Infrastructure

- Vercel payment method valid (an expired trial takes the whole app offline)
- Google Cloud billing active (free tier silently degrades AI features)
- Supabase → "Allow new users to sign up" matches your intended model

---

## Severity guide

- **Critical** — service-role key client-side, any cross-tenant data access, unauthenticated route touching user data. Do not launch.
- **High** — missing rate limit on a paid/AI route, SSRF, missing auth on a write route.
- **Medium** — missing input validation, overly permissive auth limits.
- **Low** — public repo, missing error monitoring.
