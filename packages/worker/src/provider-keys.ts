import { createDecipheriv, createHash } from "node:crypto";
import { prisma } from "./prisma";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export class ProviderKeyUnavailableError extends Error {
  constructor(provider: string, cause?: unknown) {
    super(`provider key unavailable for ${provider}`);
    this.name = "ProviderKeyUnavailableError";
    this.cause = cause;
  }
}

function getEncryptionKey(): Buffer {
  const raw = process.env.PROVIDER_KEYS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("PROVIDER_KEYS_ENCRYPTION_KEY is not set");
  }

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw).digest();
}

function decrypt(payload: string): string {
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

export async function readProviderApiKey(
  provider: string,
  channelId?: string | null,
): Promise<string> {
  try {
    if (channelId) {
      const row = await prisma.providerChannel.findUnique({
        where: { id: channelId },
        select: { provider: true, keyCiphertext: true },
      });
      if (!row || row.provider !== provider) {
        throw new Error("provider channel key row not found");
      }
      return decrypt(row.keyCiphertext);
    }

    const row = await prisma.providerKey.findUnique({
      where: { provider },
      select: { ciphertext: true },
    });
    if (!row) {
      throw new Error("provider key row not found");
    }
    return decrypt(row.ciphertext);
  } catch (error) {
    throw new ProviderKeyUnavailableError(provider, error);
  }
}

export async function readProviderHeaders(
  provider: string,
  channelId: string | null | undefined,
  apiKey: string,
): Promise<Record<string, string>> {
  if (!channelId) return {};

  const row = await prisma.providerChannel.findUnique({
    where: { id: channelId },
    select: { provider: true, headerOverride: true },
  });
  if (!row || row.provider !== provider) return {};

  return resolveStaticHeaders(row.headerOverride, apiKey);
}

function resolveStaticHeaders(value: unknown, apiKey: string): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const headers: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase();
    if (!key || isPassthroughRuleKey(key)) continue;
    if (typeof rawValue !== "string") continue;

    const trimmed = rawValue.trim();
    if (trimmed.startsWith("{client_header:")) continue;
    const resolved = trimmed.replaceAll("{api_key}", apiKey).trim();
    if (resolved) headers[key] = resolved;
  }
  return headers;
}

function isPassthroughRuleKey(key: string): boolean {
  return key === "*" || key.startsWith("re:") || key.startsWith("regex:");
}
