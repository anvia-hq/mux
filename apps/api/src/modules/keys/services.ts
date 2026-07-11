import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../utils/prisma";
import { cacheDelete, cacheGet, cacheSet } from "../../utils/cache";
import { redis } from "../../utils/redis";
import { listPublicModels, toPublicModelIdForModel } from "../../providers/registry";
import { decrypt, encrypt } from "../providers/crypto";
import type { UpdateKeyModelAccessInput } from "./schema";

const API_KEY_PREFIX = "mux_live_";

export class ApiKeySpendLimitExceededError extends Error {
  constructor() {
    super("API key spend limit exceeded");
    this.name = "ApiKeySpendLimitExceededError";
  }
}

export class ApiKeySpendLedgerUnavailableError extends Error {
  constructor(cause: unknown) {
    super("API key spend ledger unavailable");
    this.name = "ApiKeySpendLedgerUnavailableError";
    this.cause = cause;
  }
}

export class ApiKeyModelFilterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyModelFilterValidationError";
  }
}

export class ApiKeyModelAccessDeniedError extends Error {
  constructor(modelId: string) {
    super(`API key is not allowed to use model: ${modelId}`);
    this.name = "ApiKeyModelAccessDeniedError";
  }
}

export class ApiKeyNotFoundError extends Error {
  constructor() {
    super("API key not found");
    this.name = "ApiKeyNotFoundError";
  }
}

export class ApiKeyRevealUnavailableError extends Error {
  constructor(message = "API key material is unavailable") {
    super(message);
    this.name = "ApiKeyRevealUnavailableError";
  }
}

export type ApiKeyModelAccess = {
  allowAllModels: boolean;
  includeFutureModels: boolean;
  allowedModelIds: string[];
};

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { raw: string; hashed: string } {
  const raw = API_KEY_PREFIX + randomBytes(32).toString("hex");
  const hashed = hashKey(raw);
  return { raw, hashed };
}

export async function createApiKey(
  name: string,
  userId: string,
  spendLimitUsd?: number | null,
  allowedModelIds?: string[] | null,
  includeFutureModels = false,
): Promise<{ id: string; key: string }> {
  const { raw, hashed } = generateApiKey();
  const modelAccess = await buildCreateModelAccess(allowedModelIds, includeFutureModels);

  const apiKey = await prisma.apiKey.create({
    data: {
      name,
      key: hashed,
      keyCiphertext: encrypt(raw),
      createdBy: userId,
      spendLimitUsd: spendLimitUsd ?? null,
      allowAllModels: modelAccess.allowAllModels,
      includeFutureModels: modelAccess.includeFutureModels,
      allowedModelIds: modelAccess.allowedModelIds,
    },
  });

  return { id: apiKey.id, key: raw };
}

async function buildCreateModelAccess(
  allowedModelIds?: string[] | null,
  includeFutureModels = false,
): Promise<ApiKeyModelAccess> {
  if (includeFutureModels) {
    if (allowedModelIds !== undefined && allowedModelIds !== null) {
      throw new ApiKeyModelFilterValidationError(
        "includeFutureModels cannot be combined with allowedModelIds",
      );
    }

    return buildApiKeyModelAccess({ mode: "future" });
  }

  if (allowedModelIds === undefined || allowedModelIds === null) {
    return buildApiKeyModelAccess({ mode: "snapshot" });
  }

  return buildApiKeyModelAccess({ mode: "selected", allowedModelIds });
}

export async function buildApiKeyModelAccess(
  input: UpdateKeyModelAccessInput,
): Promise<ApiKeyModelAccess> {
  if (input.mode === "future") {
    return { allowAllModels: true, includeFutureModels: true, allowedModelIds: [] };
  }

  if (input.mode === "snapshot") {
    return {
      allowAllModels: false,
      includeFutureModels: false,
      allowedModelIds: await listCurrentPublicModelIds(),
    };
  }

  return {
    allowAllModels: false,
    includeFutureModels: false,
    allowedModelIds: await validateSelectedModelIds(input.allowedModelIds),
  };
}

async function validateSelectedModelIds(allowedModelIds: string[]): Promise<string[]> {
  const normalized = Array.from(
    new Set(allowedModelIds.map((modelId) => modelId.trim()).filter(Boolean)),
  );

  if (normalized.length === 0) {
    throw new ApiKeyModelFilterValidationError(
      "allowedModelIds must include at least one model when filtering models",
    );
  }

  const availableModelIds = new Set(await listCurrentPublicModelIds());
  const unknownModelIds = normalized.filter((modelId) => !availableModelIds.has(modelId));

  if (unknownModelIds.length > 0) {
    throw new ApiKeyModelFilterValidationError(
      `unknown or unavailable model(s): ${unknownModelIds.join(", ")}`,
    );
  }

  return normalized;
}

async function listCurrentPublicModelIds(): Promise<string[]> {
  const publicModels = await listPublicModels();
  return publicModels.map((model) => toPublicModelIdForModel(model));
}

export function normalizeApiKeyModelAccess(apiKey: {
  allowAllModels?: boolean | null;
  includeFutureModels?: boolean | null;
  allowedModelIds?: string[] | null;
}): ApiKeyModelAccess {
  const includeFutureModels = apiKey.includeFutureModels === true;
  const allowAllModels = apiKey.allowAllModels === true && includeFutureModels;

  return {
    allowAllModels,
    includeFutureModels,
    allowedModelIds: allowAllModels ? [] : (apiKey.allowedModelIds ?? []),
  };
}

export function isModelAllowedForApiKey(modelId: string, access: ApiKeyModelAccess): boolean {
  return access.allowAllModels || access.allowedModelIds.includes(modelId);
}

/**
 * Combines model access across every active API key owned by a user.
 * Returns null when the user has no active keys so callers can apply their
 * own fallback behavior.
 */
export async function getActiveUserModelAccess(userId: string): Promise<ApiKeyModelAccess | null> {
  const apiKeys = await prisma.apiKey.findMany({
    where: { createdBy: userId, isActive: true },
    select: {
      allowAllModels: true,
      includeFutureModels: true,
      allowedModelIds: true,
    },
  });

  if (apiKeys.length === 0) {
    return null;
  }

  const modelAccess = apiKeys.map(normalizeApiKeyModelAccess);
  if (modelAccess.some((access) => access.allowAllModels)) {
    return { allowAllModels: true, includeFutureModels: true, allowedModelIds: [] };
  }

  return {
    allowAllModels: false,
    includeFutureModels: false,
    allowedModelIds: Array.from(new Set(modelAccess.flatMap((access) => access.allowedModelIds))),
  };
}

export function assertApiKeyModelAllowed(modelId: string, access: ApiKeyModelAccess): void {
  if (!isModelAllowedForApiKey(modelId, access)) {
    throw new ApiKeyModelAccessDeniedError(modelId);
  }
}

export async function validateApiKey(rawKey: string) {
  const hashed = hashKey(rawKey);
  const cacheKey = `apikey:${hashed}`;

  // Check cache first
  let cached = null;
  try {
    cached = await cacheGet<{
      id: string;
      name: string;
      isActive: boolean;
      spendLimitUsd: number | null;
      createdBy?: string;
      ownerSpendLimitUsd?: number | null;
      allowAllModels?: boolean | null;
      includeFutureModels?: boolean | null;
      allowedModelIds?: string[] | null;
    }>(cacheKey);
  } catch {
    // Cache unavailable, fall through to DB
  }
  if (cached) {
    if (Object.hasOwn(cached, "ownerSpendLimitUsd")) {
      return cached.isActive ? { ...cached, ...normalizeApiKeyModelAccess(cached) } : null;
    }

    await deleteApiKeyCache(hashed);
  }

  // Cache miss - query database
  const apiKey = await prisma.apiKey.findUnique({
    where: { key: hashed },
    select: {
      id: true,
      name: true,
      isActive: true,
      spendLimitUsd: true,
      createdBy: true,
      creator: {
        select: { spendLimitUsd: true },
      },
      allowAllModels: true,
      includeFutureModels: true,
      allowedModelIds: true,
    },
  });

  if (!apiKey) {
    return null;
  }

  // Cache the result
  const { creator, ...apiKeyWithoutCreator } = apiKey;
  const cacheValue = {
    ...apiKeyWithoutCreator,
    ownerSpendLimitUsd: creator?.spendLimitUsd ?? null,
  };

  try {
    await cacheSet(cacheKey, cacheValue);
  } catch {
    // Cache unavailable, continue without caching
  }

  return apiKey.isActive ? { ...cacheValue, ...normalizeApiKeyModelAccess(apiKey) } : null;
}

export async function getActiveApiKeyForAuth(id: string) {
  const apiKey = await prisma.apiKey.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      isActive: true,
      spendLimitUsd: true,
      createdBy: true,
      creator: {
        select: { spendLimitUsd: true },
      },
      allowAllModels: true,
      includeFutureModels: true,
      allowedModelIds: true,
    },
  });

  if (!apiKey?.isActive) {
    return null;
  }

  const { creator, ...apiKeyWithoutCreator } = apiKey;

  return {
    ...apiKeyWithoutCreator,
    ownerSpendLimitUsd: creator?.spendLimitUsd ?? null,
    ...normalizeApiKeyModelAccess(apiKey),
  };
}

export async function revokeApiKey(id: string) {
  const apiKey = await prisma.apiKey.update({
    where: { id },
    data: { isActive: false },
  });

  // Set cache to revoked state to prevent race condition
  try {
    await cacheSet(`apikey:${apiKey.key}`, { ...apiKey, isActive: false }, 300);
  } catch {
    // Cache unavailable, DB revocation still succeeded
  }

  return apiKey;
}

export async function listApiKeys(filters: { ownerUserId?: string } = {}) {
  const keys = await prisma.apiKey.findMany({
    where: filters.ownerUserId ? { createdBy: filters.ownerUserId } : undefined,
    select: {
      id: true,
      name: true,
      keyCiphertext: true,
      createdBy: true,
      isActive: true,
      spendLimitUsd: true,
      allowAllModels: true,
      includeFutureModels: true,
      allowedModelIds: true,
      createdAt: true,
      creator: {
        select: { email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (keys.length === 0) {
    return [];
  }

  const spendRows = await prisma.requestLog.groupBy({
    by: ["apiKeyId"],
    where: {
      apiKeyId: { in: keys.map((key) => key.id) },
      statusCode: { gte: 200, lt: 300 },
      estimatedCost: { not: null },
    },
    _sum: { estimatedCost: true },
  });

  const spentByKey = new Map(
    spendRows.map((row) => [row.apiKeyId, row._sum.estimatedCost ?? 0] as const),
  );

  return keys.map((key) => {
    const { keyCiphertext, ...safeKey } = key;
    const spentUsd = spentByKey.get(key.id) ?? 0;
    const remainingUsd =
      key.spendLimitUsd === null ? null : Math.max(key.spendLimitUsd - spentUsd, 0);

    const modelAccess = normalizeApiKeyModelAccess(key);

    return {
      ...safeKey,
      canReveal: Boolean(keyCiphertext),
      allowAllModels: modelAccess.allowAllModels,
      includeFutureModels: modelAccess.includeFutureModels,
      allowedModelIds: modelAccess.allowAllModels ? null : modelAccess.allowedModelIds,
      spentUsd,
      remainingUsd,
    };
  });
}

export async function revealApiKey(input: {
  id: string;
  viewer: { id: string; role: "ADMIN" | "USER" };
}): Promise<{ key: string }> {
  const apiKey = await prisma.apiKey.findUnique({
    where: { id: input.id },
    select: {
      createdBy: true,
      isActive: true,
      keyCiphertext: true,
    },
  });

  if (!apiKey || (input.viewer.role !== "ADMIN" && apiKey.createdBy !== input.viewer.id)) {
    throw new ApiKeyNotFoundError();
  }

  if (!apiKey.isActive) {
    throw new ApiKeyRevealUnavailableError("revoked API key cannot be revealed");
  }

  if (!apiKey.keyCiphertext) {
    throw new ApiKeyRevealUnavailableError();
  }

  return { key: decrypt(apiKey.keyCiphertext) };
}

export async function rotateApiKey(input: {
  id: string;
  viewer: { id: string; role: "ADMIN" | "USER" };
}): Promise<{ key: string }> {
  const apiKey = await prisma.apiKey.findUnique({
    where: { id: input.id },
    select: {
      createdBy: true,
      isActive: true,
      key: true,
    },
  });

  if (!apiKey || (input.viewer.role !== "ADMIN" && apiKey.createdBy !== input.viewer.id)) {
    throw new ApiKeyNotFoundError();
  }

  if (!apiKey.isActive) {
    throw new ApiKeyRevealUnavailableError("revoked API key cannot be regenerated");
  }

  const next = generateApiKey();
  await prisma.apiKey.update({
    where: { id: input.id },
    data: {
      key: next.hashed,
      keyCiphertext: encrypt(next.raw),
    },
  });
  await deleteApiKeyCache(apiKey.key);

  return { key: next.raw };
}

export async function updateApiKeyModelAccess(id: string, input: UpdateKeyModelAccessInput) {
  const modelAccess = await buildApiKeyModelAccess(input);
  const apiKey = await prisma.apiKey.update({
    where: { id },
    data: {
      allowAllModels: modelAccess.allowAllModels,
      includeFutureModels: modelAccess.includeFutureModels,
      allowedModelIds: modelAccess.allowedModelIds,
    },
    select: { key: true },
  });

  await deleteApiKeyCache(apiKey.key);
}

export async function freezeLegacyApiKeyModelAccess(): Promise<number> {
  const legacyKeys = await prisma.apiKey.findMany({
    where: {
      allowAllModels: true,
      includeFutureModels: false,
    },
    select: { id: true, key: true },
  });

  if (legacyKeys.length === 0) {
    return 0;
  }

  const allowedModelIds = await listCurrentPublicModelIds();
  await prisma.apiKey.updateMany({
    where: { id: { in: legacyKeys.map((key) => key.id) } },
    data: {
      allowAllModels: false,
      includeFutureModels: false,
      allowedModelIds,
    },
  });

  await Promise.all(legacyKeys.map((key) => deleteApiKeyCache(key.key)));

  return legacyKeys.length;
}

export async function getApiKeySpentUsd(apiKeyId: string): Promise<number> {
  try {
    const value = await redis.get(apiKeySpendLedgerKey(apiKeyId));
    return value ? Number(value) : 0;
  } catch (error) {
    throw new ApiKeySpendLedgerUnavailableError(error);
  }
}

export async function getUserSpentUsd(userId: string): Promise<number> {
  try {
    const value = await redis.get(userSpendLedgerKey(userId));
    return value ? Number(value) : 0;
  } catch (error) {
    throw new ApiKeySpendLedgerUnavailableError(error);
  }
}

export async function assertApiKeyCanSpend(
  apiKeyId: string,
  spendLimitUsd: number | null | undefined,
): Promise<void> {
  if (spendLimitUsd !== null && spendLimitUsd !== undefined) {
    const spentUsd = await getApiKeySpentUsd(apiKeyId);
    if (spentUsd >= spendLimitUsd) {
      throw new ApiKeySpendLimitExceededError();
    }
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: {
      createdBy: true,
      creator: {
        select: { spendLimitUsd: true },
      },
    },
  });

  if (!apiKey) {
    return;
  }

  const userSpendLimitUsd = apiKey.creator.spendLimitUsd;
  if (userSpendLimitUsd === null || userSpendLimitUsd === undefined) {
    return;
  }

  const userSpentUsd = await getUserSpentUsd(apiKey.createdBy);
  if (userSpentUsd >= userSpendLimitUsd) {
    throw new ApiKeySpendLimitExceededError();
  }
}

export async function addApiKeySpendUsd(apiKeyId: string, spendUsd: number): Promise<number> {
  if (!Number.isFinite(spendUsd) || spendUsd <= 0) {
    return getApiKeySpentUsd(apiKeyId);
  }

  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { createdBy: true },
    });
    const transaction = redis.multi().incrbyfloat(apiKeySpendLedgerKey(apiKeyId), spendUsd);

    if (apiKey) {
      transaction.incrbyfloat(userSpendLedgerKey(apiKey.createdBy), spendUsd);
    }

    const results = await transaction.exec();
    if (!results) {
      throw new Error("Redis transaction aborted");
    }

    for (const [commandError] of results) {
      if (commandError) {
        throw commandError;
      }
    }

    const value = results[0]?.[1];
    return typeof value === "string" || typeof value === "number" ? Number(value) : 0;
  } catch (error) {
    throw new ApiKeySpendLedgerUnavailableError(error);
  }
}

export async function invalidateApiKeyCacheById(id: string): Promise<void> {
  const apiKey = await prisma.apiKey.findUnique({
    where: { id },
    select: { key: true },
  });

  if (apiKey) {
    await deleteApiKeyCache(apiKey.key);
  }
}

export async function invalidateApiKeyCachesForUser(userId: string): Promise<void> {
  const apiKeys = await prisma.apiKey.findMany({
    where: { createdBy: userId },
    select: { key: true },
  });

  await Promise.all(apiKeys.map((apiKey) => deleteApiKeyCache(apiKey.key)));
}

async function deleteApiKeyCache(hashedKey: string) {
  try {
    await cacheDelete(`apikey:${hashedKey}`);
  } catch {
    // Cache unavailable, DB update still succeeded.
  }
}

function apiKeySpendLedgerKey(apiKeyId: string): string {
  return `apikey_spend:${apiKeyId}`;
}

function userSpendLedgerKey(userId: string): string {
  return `user_spend:${userId}`;
}
