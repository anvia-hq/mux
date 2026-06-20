import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * AES-256-GCM encryption for provider API keys at rest.
 *
 * The encryption key is derived from `PROVIDER_KEYS_ENCRYPTION_KEY`. Accepts:
 * - 32 raw bytes (64 hex chars)
 * - any string (hashed with SHA-256 to produce a 32-byte key) — convenient for dev
 *
 * The on-disk format is a single base64 string containing:
 *   [12-byte IV][16-byte auth tag][N-byte ciphertext]
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getEncryptionKey(): Buffer {
  const raw = process.env.PROVIDER_KEYS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "PROVIDER_KEYS_ENCRYPTION_KEY is not set. Set it to a 64-char hex string or any string (it will be hashed).",
    );
  }

  // Accept 64-char hex as raw bytes; otherwise SHA-256 the value.
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw).digest();
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(payload: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("ciphertext is too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/**
 * Returns the last 4 characters of the API key for display purposes.
 * For keys shorter than 4 chars returns the full key (avoid empty string).
 */
export function lastFour(key: string): string {
  return key.length >= 4 ? key.slice(-4) : key;
}
