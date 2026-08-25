import crypto from "crypto";

/**
 * Envelope encryption for Playwright `storageState` blobs before they are
 * written to `browser_sessions`.
 *
 * A storageState blob is not "sensitive data" in the ordinary sense — it is a
 * working credential. Whoever holds it is that customer on that platform, with
 * no password prompt and no second factor, until the cookies expire. Treating
 * it like an API key is the floor, not caution.
 *
 * AES-256-GCM rather than CBC or a bare cipher: GCM authenticates as well as
 * encrypts, so a row that has been tampered with fails to decrypt instead of
 * yielding attacker-shaped JSON that then gets fed straight into a browser
 * context.
 */

const ALGORITHM = "aes-256-gcm";

/**
 * GCM's standard nonce length. 12 bytes, not 16: GCM specifies 96-bit IVs, and
 * anything else forces an extra derivation step inside the cipher for no gain.
 */
const IV_LENGTH = 12;

const KEY_ENV = "SESSION_ENCRYPTION_KEY";

export const SESSION_KEY_HINT =
  `Set ${KEY_ENV} to a base64-encoded 32-byte key. Generate one with: ` +
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`;

/** The key version new rows are written at. See the migration for rotation. */
export const CURRENT_KEY_VERSION = 1;

export type SealedState = {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
};

/**
 * Resolve the key for a given version.
 *
 * Rotation works by introducing `SESSION_ENCRYPTION_KEY_V2` alongside the
 * existing key and bumping CURRENT_KEY_VERSION: new rows seal with v2 while
 * v1 rows stay readable until they are rewritten. Without per-version lookup,
 * changing the key would leave every stored session undecryptable — which
 * presents to customers as every platform spontaneously disconnecting.
 */
function getKey(version: number): Buffer {
  const envName = version === 1 ? KEY_ENV : `${KEY_ENV}_V${version}`;
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`${envName} is not set. ${SESSION_KEY_HINT}`);
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `${envName} must decode to exactly 32 bytes for AES-256, got ${key.length}. ${SESSION_KEY_HINT}`
    );
  }
  return key;
}

/** Whether a usable key is configured, without throwing. */
export function hasSessionKey(): boolean {
  try {
    getKey(CURRENT_KEY_VERSION);
    return true;
  } catch {
    return false;
  }
}

export function sealStorageState(state: unknown): SealedState {
  const key = getKey(CURRENT_KEY_VERSION);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = Buffer.from(JSON.stringify(state), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * Returns null when the row cannot be decrypted — a wrong or rotated-away key,
 * or a tampered row.
 *
 * Null rather than throwing because the only caller that matters is the
 * crawler, iterating every customer's sessions. One unreadable row should cost
 * that one customer's crawl and be logged by name, not abort the run for
 * everybody else.
 */
export function openStorageState(sealed: SealedState): unknown | null {
  try {
    const key = getKey(sealed.keyVersion);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(sealed.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]);

    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    return null;
  }
}
