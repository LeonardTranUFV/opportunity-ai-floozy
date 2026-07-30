import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client that bypasses RLS — for server-only code that needs to
 * act across every user's rows at once (currently just the cron auto-scan
 * route, which has no logged-in user to scope a normal client to). Never
 * import this into anything reachable from a request the client can shape,
 * and every query built on top of it must filter by user_id itself since RLS
 * isn't doing it anymore.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
