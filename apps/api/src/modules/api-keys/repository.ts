import type { Database } from "@mux/db";
import { apiKeys } from "@mux/db/schema/api-keys";
import { desc, eq } from "drizzle-orm";
import type { ApiKeyRecord, ApiKeysRepository, InsertApiKeyData } from "./types";

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
    const rows = await db.insert(apiKeys).values(data).returning();

    return rows[0];
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
