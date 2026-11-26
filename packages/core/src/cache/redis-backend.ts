import type { RedisClient } from "bun";
import type { RedisBackend } from "./types";

const REDIS_BATCH_SIZE = 500;

export const createBunRedisBackend = (client: RedisClient): RedisBackend => ({
  get: async (key) => client.get(key),

  setEx: async (key, value, ttlSeconds) => {
    await client.set(key, value, "EX", ttlSeconds);
  },

  del: async (keys) => {
    let deleted = 0;

    for (let i = 0; i < keys.length; i += REDIS_BATCH_SIZE) {
      const batch = keys.slice(i, i + REDIS_BATCH_SIZE);

      deleted += await client.del(...batch);
    }

    return deleted;
  },

  sadd: async (key, members) => {
    let added = 0;

    for (let i = 0; i < members.length; i += REDIS_BATCH_SIZE) {
      const batch = members.slice(i, i + REDIS_BATCH_SIZE);

      added += await client.sadd(key, ...batch);
    }

    return added;
  },

  smembers: async (key) => client.smembers(key),

  expire: async (key, ttlSeconds) => {
    await client.expire(key, ttlSeconds);
  },

  ttl: async (key) => client.ttl(key),
});
