import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../utils/prisma";
import { cacheGet, cacheSet } from "../../utils/cache";
import { redis } from "../../utils/redis";
import { listPublicModels, toPublicModelId } from "../../providers/registry";

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

export type ApiKeyModelAccess = {
  allowAllModels: boolean;
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
): Promise<{ id: string; key: string }> {
  const { raw, hashed } = generateApiKey();
  const modelAccess = await buildModelAccess(allowedModelIds);

  const apiKey = await prisma.apiKey.create({
    data: {
      name,
      key: hashed,
      createdBy: userId,
      spendLimitUsd: spendLimitUsd ?? null,
      allowAllModels: modelAccess.allowAllModels,
      allowedModelIds: modelAccess.allowedModelIds,
    },
  });

  return { id: apiKey.id, key: raw };
}

async function buildModelAccess(allowedModelIds?: string[] | null): Promise<ApiKeyModelAccess> {
  if (allowedModelIds === undefined || allowedModelIds === null) {
    return { allowAllModels: true, allowedModelIds: [] };
  }

  const normalized = Array.from(
    new Set(allowedModelIds.map((modelId) => modelId.trim()).filter(Boolean)),
  );

  if (normalized.length === 0) {
    throw new ApiKeyModelFilterValidationError(
      "allowedModelIds must include at least one model when filtering models",
    );
  }

  const publicModels = await listPublicModels();
  const availableModelIds = new Set(
    publicModels.map((model) => toPublicModelId(model.provider, model.id)),
  );
  const unknownModelIds = normalized.filter((modelId) => !availableModelIds.has(modelId));

  if (unknownModelIds.length > 0) {
    throw new ApiKeyModelFilterValidationError(
      `unknown or unavailable model(s): ${unknownModelIds.join(", ")}`,
    );
  }

  return { allowAllModels: false, allowedModelIds: normalized };
}

export function normalizeApiKeyModelAccess(apiKey: {
  allowAllModels?: boolean | null;
  allowedModelIds?: string[] | null;
}): ApiKeyModelAccess {
  const allowAllModels = apiKey.allowAllModels !== false;

  return {
    allowAllModels,
    allowedModelIds: allowAllModels ? [] : (apiKey.allowedModelIds ?? []),
  };
}

export function isModelAllowedForApiKey(modelId: string, access: ApiKeyModelAccess): boolean {
  return access.allowAllModels || access.allowedModelIds.includes(modelId);
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
      allowAllModels?: boolean | null;
      allowedModelIds?: string[] | null;
    }>(cacheKey);
  } catch {
    // Cache unavailable, fall through to DB
  }
  if (cached) {
    return cached.isActive ? { ...cached, ...normalizeApiKeyModelAccess(cached) } : null;
  }

  // Cache miss - query database
  const apiKey = await prisma.apiKey.findUnique({
    where: { key: hashed },
    select: {
      id: true,
      name: true,
      isActive: true,
      spendLimitUsd: true,
      allowAllModels: true,
      allowedModelIds: true,
    },
  });

  if (!apiKey) {
    return null;
  }

  // Cache the result
  try {
    await cacheSet(cacheKey, apiKey);
  } catch {
    // Cache unavailable, continue without caching
  }

  return apiKey.isActive ? { ...apiKey, ...normalizeApiKeyModelAccess(apiKey) } : null;
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

export async function listApiKeys() {
  const keys = await prisma.apiKey.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      spendLimitUsd: true,
      allowAllModels: true,
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
    const spentUsd = spentByKey.get(key.id) ?? 0;
    const remainingUsd =
      key.spendLimitUsd === null ? null : Math.max(key.spendLimitUsd - spentUsd, 0);

    const modelAccess = normalizeApiKeyModelAccess(key);

    return {
      ...key,
      allowAllModels: modelAccess.allowAllModels,
      allowedModelIds: modelAccess.allowAllModels ? null : modelAccess.allowedModelIds,
      spentUsd,
      remainingUsd,
    };
  });
}

export async function getApiKeySpentUsd(apiKeyId: string): Promise<number> {
  try {
    const value = await redis.get(apiKeySpendLedgerKey(apiKeyId));
    return value ? Number(value) : 0;
  } catch (error) {
    throw new ApiKeySpendLedgerUnavailableError(error);
  }
}

export async function assertApiKeyCanSpend(
  apiKeyId: string,
  spendLimitUsd: number | null | undefined,
): Promise<void> {
  if (spendLimitUsd === null || spendLimitUsd === undefined) {
    return;
  }

  const spentUsd = await getApiKeySpentUsd(apiKeyId);
  if (spentUsd >= spendLimitUsd) {
    throw new ApiKeySpendLimitExceededError();
  }
}

export async function addApiKeySpendUsd(apiKeyId: string, spendUsd: number): Promise<number> {
  if (!Number.isFinite(spendUsd) || spendUsd <= 0) {
    return getApiKeySpentUsd(apiKeyId);
  }

  try {
    const value = await redis.incrbyfloat(apiKeySpendLedgerKey(apiKeyId), spendUsd);
    return Number(value);
  } catch (error) {
    throw new ApiKeySpendLedgerUnavailableError(error);
  }
}

function apiKeySpendLedgerKey(apiKeyId: string): string {
  return `apikey_spend:${apiKeyId}`;
}
