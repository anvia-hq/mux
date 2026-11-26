import type { RedisBackend } from "../types";

interface StoredString {
  value: string;
  expiresAtMs: number;
}

interface StoredSet {
  members: Set<string>;
  expiresAtMs: number | null;
}

export const createMemoryRedisBackend = (now: () => number = Date.now): RedisBackend => {
  const strings = new Map<string, StoredString>();
  const sets = new Map<string, StoredSet>();

  const pruneString = (key: string): StoredString | undefined => {
    const entry = strings.get(key);

    if (!entry) {
      return undefined;
    }

    if (now() >= entry.expiresAtMs) {
      strings.delete(key);

      return undefined;
    }

    return entry;
  };

  const pruneSet = (key: string): StoredSet | undefined => {
    const entry = sets.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAtMs !== null && now() >= entry.expiresAtMs) {
      sets.delete(key);

      return undefined;
    }

    return entry;
  };

  return {
    get: async (key) => {
      const entry = pruneString(key);

      return entry ? entry.value : null;
    },

    setEx: async (key, value, ttlSeconds) => {
      strings.set(key, {
        value,
        expiresAtMs: now() + ttlSeconds * 1000,
      });
    },

    del: async (keys) => {
      let deleted = 0;

      for (const key of keys) {
        const removedString = strings.delete(key);
        const removedSet = sets.delete(key);

        if (removedString || removedSet) {
          deleted += 1;
        }
      }

      return deleted;
    },

    sadd: async (key, members) => {
      let entry = pruneSet(key);

      if (!entry) {
        entry = { members: new Set(), expiresAtMs: null };
        sets.set(key, entry);
      }

      let added = 0;

      for (const member of members) {
        if (!entry.members.has(member)) {
          entry.members.add(member);
          added += 1;
        }
      }

      return added;
    },

    smembers: async (key) => {
      const entry = pruneSet(key);

      if (!entry) {
        return [];
      }

      return [...entry.members];
    },

    expire: async (key, ttlSeconds) => {
      const stringEntry = pruneString(key);

      if (stringEntry) {
        stringEntry.expiresAtMs = now() + ttlSeconds * 1000;
      }

      const setEntry = pruneSet(key);

      if (setEntry) {
        setEntry.expiresAtMs = now() + ttlSeconds * 1000;
      }
    },
  };
};
