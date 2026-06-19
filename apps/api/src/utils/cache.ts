import { redis } from "./redis";

const DEFAULT_TTL = 600; // 10 minutes

export async function cacheGet<T>(key: string): Promise<T | null> {
  const data = await redis.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttl = DEFAULT_TTL): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", ttl);
}

export async function cacheDelete(key: string): Promise<void> {
  await redis.del(key);
}
