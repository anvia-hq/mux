import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { sha256Hex } from "./canonical-json";
import type { GeneratedApiKey, SecretVault } from "./types";

const TOKEN_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MIN_KEY_LENGTH = 32;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;

const decodeStrictBase64Url = (encoded: string): Buffer => {
  if (!BASE64URL_PATTERN.test(encoded)) {
    throw new Error("Invalid base64url encoding in secret token.");
  }

  const decoded = Buffer.from(encoded, "base64url");

  if (decoded.toString("base64url") !== encoded) {
    throw new Error("Non-canonical base64url encoding in secret token.");
  }

  return decoded;
};

const deriveKeyMaterial = (masterKey: string): Buffer => {
  const trimmed = masterKey.trim();

  if (trimmed.length < MIN_KEY_LENGTH) {
    throw new Error(`Master key must be at least ${MIN_KEY_LENGTH} characters long.`);
  }

  if (HEX_KEY_PATTERN.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  return createHash("sha256").update(trimmed, "utf8").digest();
};

export const createSecretVault = (masterKey: string): SecretVault => {
  const key = deriveKeyMaterial(masterKey);

  const encrypt = (plaintext: string): string => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      TOKEN_VERSION,
      iv.toString("base64url"),
      authTag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  };

  const decrypt = (token: string): string => {
    const parts = token.split(".");

    if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
      throw new Error("Invalid encrypted secret token format.");
    }

    const iv = decodeStrictBase64Url(parts[1]);
    const authTag = decodeStrictBase64Url(parts[2]);
    const ciphertext = decodeStrictBase64Url(parts[3]);

    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new Error("Invalid encrypted secret token metadata.");
    }

    const decipher = createDecipheriv("aes-256-gcm", key, iv);

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return decrypted.toString("utf8");
  };

  const encryptJson = (value: unknown): string => encrypt(JSON.stringify(value));

  const decryptJson = <T>(token: string, parse: (value: unknown) => T): T => {
    const parsed: unknown = JSON.parse(decrypt(token));

    return parse(parsed);
  };

  return {
    encrypt,
    decrypt,
    encryptJson,
    decryptJson,
  };
};

export const hashApiKey = (rawKey: string): string => sha256Hex(rawKey);

export const generateApiKey = (prefix = "mux_live"): GeneratedApiKey => {
  const secret = randomBytes(32).toString("base64url");
  const rawKey = `${prefix}_${secret}`;
  const keyPrefix = rawKey.slice(0, prefix.length + 9);
  const keyHash = hashApiKey(rawKey);

  return { rawKey, keyPrefix, keyHash };
};

export const verifyApiKeyHash = (rawKey: string, expectedHash: string): boolean => {
  const actualHash = hashApiKey(rawKey);
  const actualBuf = Buffer.from(actualHash, "hex");
  const expectedBuf = Buffer.from(expectedHash, "hex");

  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(actualBuf, expectedBuf);
};
