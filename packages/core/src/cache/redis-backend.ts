import type { RedisClient } from "bun";
import type { RedisBackend } from "./types";

export const createBunRedisBackend = (client: RedisClient): RedisBackend => ({
  get: async (key) => client.get(key),

  setEx: async (key, value, ttlSeconds) => {
    await client.set(key, value, "EX", ttlSeconds);
  },

  del: async (keys) => {
    if (keys.length === 0) {
      return 0;
    }

    return client.del(...keys);
  },

  sadd: async (key, members) => {
    if (members.length === 0) {
      return 0;
    }

    return client.sadd(key, ...members);
  },

  smembers: async (key) => client.smembers(key),

  expire: async (key, ttlSeconds) => {
    await client.expire(key, ttlSeconds);
  },
});
