import { createAdminClient } from "@/lib/supabase/admin";
import {
  openStorageState,
  sealStorageState,
  hasSessionKey,
  type SealedState,
} from "@/lib/session-crypto";

/**
 * Reading and writing customers' platform logins as portable
 * Playwright `storageState` blobs, so a crawl can run on any machine.
 *
 * This is the half of the browser-session move that replaces
 * `getAuthSessionPath()`'s "one directory on one PC" with something a fleet
 * can share. The disk path still exists and still works — see
 * lib/auth-session.ts — because sessions already connected on the operator's
 * machine must keep crawling while customers migrate onto self-serve connect.
 *
 * Everything here uses the service-role client: `browser_sessions` has RLS on
 * with no policies, so it is unreachable any other way, and every query below
 * therefore filters by user_id itself.
 */

export type SessionStatus = "active" | "expired" | "revoked";

/** Platforms that need a signed-in browser. Reddit is absent on purpose: it
 *  reads through its own API and never needs a session. */
export const SESSION_PLATFORMS = ["facebook", "linkedin", "nextdoor", "twitter"] as const;
export type SessionPlatform = (typeof SESSION_PLATFORMS)[number];

export function isSessionPlatform(platform: string): platform is SessionPlatform {
  return (SESSION_PLATFORMS as readonly string[]).includes(platform);
}

type SessionRow = {
  user_id: string;
  platform: string;
  state_ciphertext: string;
  state_iv: string;
  state_tag: string;
  key_version: number;
  status: SessionStatus;
  connected_at: string;
  updated_at: string;
  last_verified_at: string | null;
};

/** What the UI is allowed to know: that a connection exists, and how it is
 *  doing. Never the credential. */
export type SessionSummary = {
  platform: string;
  status: SessionStatus;
  connectedAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
};

function toSealed(row: SessionRow): SealedState {
  return {
    ciphertext: row.state_ciphertext,
    iv: row.state_iv,
    tag: row.state_tag,
    keyVersion: row.key_version,
  };
}

/**
 * Persist a freshly captured login. Called at the end of a successful connect,
 * and again whenever a crawl observes refreshed cookies — platforms rotate
 * session cookies as you browse, and writing the newer state back is what
 * keeps a connection alive for months instead of days.
 */
export async function saveSession(
  userId: string,
  platform: SessionPlatform,
  storageState: unknown
): Promise<void> {
  if (!hasSessionKey()) {
    // Refuse rather than storing a credential in the clear. A connect flow
    // that appears to succeed and silently writes plaintext is worse than one
    // that fails loudly on the operator's own misconfiguration.
    throw new Error(
      "Refusing to store a browser session without an encryption key configured."
    );
  }

  const sealed = sealStorageState(storageState);
  const now = new Date().toISOString();

  const supabase = createAdminClient();
  const { error } = await supabase.from("browser_sessions").upsert(
    {
      user_id: userId,
      platform,
      state_ciphertext: sealed.ciphertext,
      state_iv: sealed.iv,
      state_tag: sealed.tag,
      key_version: sealed.keyVersion,
      status: "active" satisfies SessionStatus,
      updated_at: now,
      last_verified_at: now,
    },
    { onConflict: "user_id,platform" }
  );

  if (error) throw new Error(`Could not store ${platform} session: ${error.message}`);
}

/**
 * The decrypted storageState for one customer and platform, or null when
 * there is nothing usable — no row, a disconnected one, or a row this
 * deployment holds no key for.
 *
 * Null is not an error condition. Aimed at production, the crawler sees every
 * customer's sources and most will not be connected; callers are expected to
 * skip and say so by name.
 */
export async function loadSession(
  userId: string,
  platform: string
): Promise<unknown | null> {
  if (!isSessionPlatform(platform)) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("browser_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", platform)
    .maybeSingle<SessionRow>();

  if (error || !data) return null;
  if (data.status !== "active") return null;

  return openStorageState(toSealed(data));
}

/**
 * Whether a usable session exists, without paying to decrypt it.
 *
 * Presence still is not proof of validity — cookies expire in place, and only
 * a real request to the platform can tell the difference. This answers "is it
 * worth starting a browser for this customer", which is the question the
 * crawler actually has.
 */
export async function hasStoredSession(userId: string, platform: string): Promise<boolean> {
  if (!isSessionPlatform(platform)) return false;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("browser_sessions")
    .select("user_id")
    .eq("user_id", userId)
    .eq("platform", platform)
    .eq("status", "active")
    .maybeSingle();

  return !error && Boolean(data);
}

/** Every platform this customer has connected, for rendering Connect Accounts. */
export async function listSessions(userId: string): Promise<SessionSummary[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("browser_sessions")
    .select("*")
    .eq("user_id", userId)
    .returns<SessionRow[]>();

  if (error || !data) return [];

  return data.map((row) => ({
    platform: row.platform,
    status: row.status,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at,
  }));
}

/**
 * Mark a session unusable after the platform rejected it.
 *
 * Kept as a row in 'expired' rather than deleted so Connect Accounts can say
 * "your Facebook connection expired, reconnect" — a disappearing row reads to
 * a customer as the app having forgotten they ever connected.
 */
export async function markSessionExpired(userId: string, platform: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("browser_sessions")
    .update({ status: "expired" satisfies SessionStatus, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("platform", platform);
}

/**
 * Customer-initiated disconnect. The credential itself is overwritten rather
 * than left sitting in a row flagged 'revoked' — "disconnect" has to mean the
 * cookies are gone, not merely ignored.
 */
export async function revokeSession(userId: string, platform: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("browser_sessions")
    .update({
      state_ciphertext: "",
      state_iv: "",
      state_tag: "",
      status: "revoked" satisfies SessionStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("platform", platform);
}
