// Sign an account into a platform on THIS PC, for local collection.
//
// Usage:
//   npx tsx scripts/local-login.ts --env .env.worker --platform facebook
//   npx tsx scripts/local-login.ts --env .env.worker --platform nextdoor --user <uuid>
//
// Opens a visible Chrome on the Chrome profile the worker crawls with
// (../.auth_sessions/<user>/<platform>). Log in, finish any 2FA, then close
// the window — the profile keeps the session, and RUN-WORKER.bat uses it.
//
// Why this exists rather than the Connect page:
//
//   - The hosted Connect page logs in through a browser rented from a
//     datacentre. For an account collected locally that means the session is
//     born on one IP and then used from a residential one — the jump itself is
//     a signal, and the first thing a new account does is the most scrutinised.
//   - The local dev server's login route runs against the development
//     database, so it files the profile under the dev user's id, which is not
//     the id the production worker looks for.
//
// This does neither: the login happens here, on the id the worker will read,
// with the same browser fingerprint the crawl will present (see
// localProfileLaunchOptions) — a session captured by one fingerprint and
// replayed by another is its own inconsistency.

import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { getChromium } from "@/lib/browser";
import { localProfileLaunchOptions } from "@/lib/browser-context";
import { getAuthSessionPath } from "@/lib/auth-session";
import { hasStoredSession, isSessionPlatform } from "@/lib/session-store";
import { usersCollectingLocally } from "@/lib/collection-mode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const HOME: Record<string, string> = {
  facebook: "https://www.facebook.com/",
  nextdoor: "https://nextdoor.com/",
  linkedin: "https://www.linkedin.com/",
  twitter: "https://x.com/",
};

async function main() {
  const envFile = arg("env") ?? ".env.worker";
  const loaded = config({ path: path.resolve(projectRoot, envFile) });
  if (loaded.error) {
    console.error(`[local-login] could not read ${envFile}: ${loaded.error.message}`);
    process.exit(1);
  }

  const platform = (arg("platform") ?? "").toLowerCase();
  if (!isSessionPlatform(platform)) {
    console.error(`[local-login] --platform must be one of: ${Object.keys(HOME).join(", ")}`);
    process.exit(1);
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Whose login this is. Defaults to the one account marked for local
  // collection, since that is who this machine crawls; anything ambiguous is
  // refused rather than guessed, because a login filed under the wrong id is a
  // session nobody will ever use.
  let userId = arg("user");
  if (!userId) {
    const local = [...(await usersCollectingLocally(supabase))];
    if (local.length !== 1) {
      console.error(
        local.length === 0
          ? "[local-login] no account is marked for local collection — pass --user <uuid>."
          : `[local-login] ${local.length} accounts are marked local — pass --user <uuid> to choose one.`
      );
      process.exit(1);
    }
    userId = local[0];
  }

  // The worker prefers a stored (cloud-captured) session over this profile
  // whenever one is active. Said now, before the login, not discovered later
  // as "I logged in and it still uses the old account".
  if (await hasStoredSession(userId, platform)) {
    console.log(
      `\n  ! This account still has an active ${platform} session stored from the hosted Connect page.\n` +
        `    The worker uses that one before this profile. Press Disconnect on ${platform} in the app\n` +
        `    (Connect Accounts), or the login you are about to do here will be ignored.\n`
    );
  }

  const profileDir = getAuthSessionPath(userId, platform);
  console.log(`[local-login] ${platform} for user ${userId}`);
  console.log(`[local-login] profile: ${profileDir}`);
  console.log(`[local-login] log in, finish any 2FA, then CLOSE THE CHROME WINDOW to save.\n`);

  const chromium = await getChromium();
  const context = await chromium.launchPersistentContext(profileDir, await localProfileLaunchOptions(chromium, false));
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(HOME[platform], { waitUntil: "domcontentloaded" });

  await new Promise<void>((resolve) => context.on("close", () => resolve()));
  console.log(`[local-login] window closed — session saved to the profile. RUN-WORKER.bat will crawl with it.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[local-login] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
