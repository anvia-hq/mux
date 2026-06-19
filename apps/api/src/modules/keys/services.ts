import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../utils/prisma";
import { cacheGet, cacheSet } from "../../utils/cache";

const API_KEY_PREFIX = "mux_live_";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { raw: string; hashed: string } {
  const raw = API_KEY_PREFIX + randomBytes(32).toString("hex");
  const hashed = hashKey(raw);
  return { raw, hashed };
}

export async function createApiKey(name: string, userId: string): Promise<{ id: string; key: string }> {
  const { raw, hashed } = generateApiKey();

  const apiKey = await prisma.apiKey.create({
    data: {
      name,
      key: hashed,
      createdBy: userId,
    },
  });

  return { id: apiKey.id, key: raw };
}

export async function validateApiKey(rawKey: string) {
  const hashed = hashKey(rawKey);
  const cacheKey = `apikey:${hashed}`;

  // Check cache first
  let cached = null;
  try {
    cached = await cacheGet<{ id: string; name: string; isActive: boolean }>(cacheKey);
  } catch {
    // Cache unavailable, fall through to DB
  }
  if (cached) {
    return cached.isActive ? cached : null;
  }

  // Cache miss - query database
  const apiKey = await prisma.apiKey.findUnique({
    where: { key: hashed },
    select: { id: true, name: true, isActive: true },
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

  return apiKey.isActive ? apiKey : null;
}

export async function revokeApiKey(id: string) {
  const apiKey = await prisma.apiKey.update({
    where: { id },
    data: { isActive: false },
  });

  // Set cache to revoked state to prevent race condition
  await cacheSet(`apikey:${apiKey.key}`, { ...apiKey, isActive: false }, 300);

  return apiKey;
}

export async function listApiKeys() {
  return prisma.apiKey.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      createdAt: true,
      creator: {
        select: { email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
