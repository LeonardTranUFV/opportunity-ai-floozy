import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who is an operator, and who may read the shared pool.
 *
 * ── Why this is not in the database ────────────────────────────────────────
 *
 * Both of these used to be rows in `settings`: `is_admin` and `pool_access`,
 * read back and compared to the string "true". `settings` is a per-user
 * key/value table whose RLS policies deliberately let a customer insert and
 * update their own rows — that is the whole point of it, it holds their
 * business profile and their AI preferences.
 *
 * So the privilege check was reading a value the customer could write. Any
 * signed-up account could POST {"is_admin":"true"} to /api/settings — or write
 * the row straight through supabase-js with the anon key, which the browser
 * already holds — and become an operator. That unlocked granting credits to
 * any account, and reading other customers' leads out of the pool.
 *
 * Privilege must live somewhere the person whose privilege it is cannot
 * reach. The deployment environment is that place: only whoever can configure
 * the Vercel project can change it, and no request can.
 *
 * ── Fails closed ──────────────────────────────────────────────────────────
 *
 * With nothing configured, nobody is an operator. An empty allowlist locking
 * the operator out of an admin page is a bad afternoon; an empty allowlist
 * that defaults to "allow" is the bug this file exists to remove.
 */

/** Comma- or space-separated, tolerant of stray whitespace and casing. */
function allowList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The signed-in caller's email, or null.
 *
 * Only meaningful when `supabase` is a request-scoped client carrying a
 * session. A service-role client has no user, so this returns null and the
 * check falls back to matching by id — which is the safe direction.
 */
async function callerEmail(supabase: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) return data.user.email.toLowerCase();
  } catch {
    // fall through to the admin lookup
  }
  // No session — the scheduled collector runs with the service role on
  // behalf of each customer in turn. Without this, an email allowlist was
  // invisible to the cron and an admin's own sources were capped there
  // while the same account showed as unlimited in the browser.
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    return data.user?.email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

async function isListed(
  supabase: SupabaseClient,
  userId: string,
  idsRaw: string | undefined,
  emailsRaw: string | undefined
): Promise<boolean> {
  const ids = allowList(idsRaw);
  if (ids.includes(userId.toLowerCase())) return true;

  const emails = allowList(emailsRaw);
  if (emails.length === 0) return false;

  const email = await callerEmail(supabase, userId);
  return !!email && emails.includes(email);
}

/**
 * Operator. Can grant and deduct credits on any account, and sees the
 * Integrations panel.
 *
 * Configure with ADMIN_USER_IDS (Supabase auth user ids) or ADMIN_EMAILS.
 * Ids are the stronger of the two — an email is only as trustworthy as the
 * address on the account — so prefer ids once you know them.
 */
export async function isAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return isListed(supabase, userId, process.env.ADMIN_USER_IDS, process.env.ADMIN_EMAILS);
}

/**
 * May read the shared opportunity pool — other customers' leads, which they
 * opted in to contribute.
 *
 * Separate from admin on purpose, so an agency client can be given read
 * access without also being able to grant it to anyone else. Admins have it
 * implicitly, which is how it behaved before.
 *
 * Configure with POOL_ACCESS_USER_IDS or POOL_ACCESS_EMAILS.
 */
export async function hasPoolAccess(supabase: SupabaseClient, userId: string): Promise<boolean> {
  if (await isListed(supabase, userId, process.env.POOL_ACCESS_USER_IDS, process.env.POOL_ACCESS_EMAILS)) {
    return true;
  }
  return isAdmin(supabase, userId);
}
