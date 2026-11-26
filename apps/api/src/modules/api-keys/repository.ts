import type { Database } from "@mux/db";
import { apiKeys } from "@mux/db/schema/api-keys";
import { desc, eq } from "drizzle-orm";
import { NotFoundError } from "../../errors";
import type { ApiKeyRecord, ApiKeysRepository, InsertApiKeyData } from "./types";

const hasPgErrorCode = (error: unknown, code: string): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error && error.code === code) {
    return true;
  }

  if ("cause" in error && typeof error.cause === "object" && error.cause !== null) {
    return "code" in error.cause && error.cause.code === code;
  }

  return false;
};

export const createDrizzleApiKeysRepository = (db: Database): ApiKeysRepository => ({
  listAll: async (): Promise<ApiKeyRecord[]> =>
    db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)),

  listByCreator: async (userId: string): Promise<ApiKeyRecord[]> =>
    db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.createdById, userId))
      .orderBy(desc(apiKeys.createdAt)),

  findById: async (id: string): Promise<ApiKeyRecord | null> => {
    const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);

    return rows[0] ?? null;
  },

  findByHash: async (keyHash: string): Promise<ApiKeyRecord | null> => {
    const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);

    return rows[0] ?? null;
  },

  insert: async (data: InsertApiKeyData): Promise<ApiKeyRecord> => {
    try {
      const rows = await db.insert(apiKeys).values(data).returning();
      const inserted = rows[0];

      if (!inserted) {
        throw new Error("Failed to insert API key.");
      }

      return inserted;
    } catch (error) {
      if (hasPgErrorCode(error, "23503")) {
        throw new NotFoundError("Referenced endpoint or user not found.");
      }

      throw error;
    }
  },

  revoke: async (id: string, revokedAt: Date): Promise<ApiKeyRecord | null> => {
    const rows = await db
      .update(apiKeys)
      .set({ revokedAt, updatedAt: revokedAt })
      .where(eq(apiKeys.id, id))
      .returning();

    return rows[0] ?? null;
  },

  touchLastUsed: async (id: string, usedAt: Date): Promise<void> => {
    await db.update(apiKeys).set({ lastUsedAt: usedAt }).where(eq(apiKeys.id, id));
  },
});
