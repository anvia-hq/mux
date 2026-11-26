import type { Database } from "@mux/db";
import { endpointTools } from "@mux/db/schema/endpoint-tools";
import { toolSources } from "@mux/db/schema/tool-sources";
import { tools } from "@mux/db/schema/tools";
import { desc, eq } from "drizzle-orm";
import { ConflictError } from "../../errors";
import type {
  InsertSourceData,
  SourcesRepository,
  ToolSourceRecord,
  UpdateSourceData,
} from "./types";

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

export const createDrizzleSourcesRepository = (db: Database): SourcesRepository => ({
  list: async (): Promise<ToolSourceRecord[]> =>
    db.select().from(toolSources).orderBy(desc(toolSources.createdAt)),

  findById: async (id: string): Promise<ToolSourceRecord | null> => {
    const rows = await db.select().from(toolSources).where(eq(toolSources.id, id)).limit(1);

    return rows[0] ?? null;
  },

  findBySlug: async (slug: string): Promise<ToolSourceRecord | null> => {
    const rows = await db.select().from(toolSources).where(eq(toolSources.slug, slug)).limit(1);

    return rows[0] ?? null;
  },

  insert: async (data: InsertSourceData): Promise<ToolSourceRecord> => {
    try {
      const rows = await db.insert(toolSources).values(data).returning();
      const inserted = rows[0];

      if (!inserted) {
        throw new Error("Failed to insert tool source.");
      }

      return inserted;
    } catch (error) {
      if (hasPgErrorCode(error, "23505")) {
        throw new ConflictError(`Tool source slug '${data.slug}' already exists.`);
      }

      throw error;
    }
  },

  update: async (id: string, data: UpdateSourceData): Promise<ToolSourceRecord | null> => {
    const patch: Partial<typeof toolSources.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) {
      patch.name = data.name;
    }

    if (data.description !== undefined) {
      patch.description = data.description;
    }

    if (data.status !== undefined) {
      patch.status = data.status;
    }

    if (data.config !== undefined) {
      patch.config = data.config;
    }

    if (data.encryptedSecrets !== undefined) {
      patch.encryptedSecrets = data.encryptedSecrets;
    }

    if (data.lastSyncedAt !== undefined) {
      patch.lastSyncedAt = data.lastSyncedAt;
    }

    if (data.lastError !== undefined) {
      patch.lastError = data.lastError;
    }

    const rows = await db.update(toolSources).set(patch).where(eq(toolSources.id, id)).returning();

    return rows[0] ?? null;
  },

  remove: async (id: string): Promise<boolean> => {
    const rows = await db
      .delete(toolSources)
      .where(eq(toolSources.id, id))
      .returning({ id: toolSources.id });

    return rows.length > 0;
  },

  listAffectedEndpointIds: async (sourceId: string): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ endpointId: endpointTools.endpointId })
      .from(endpointTools)
      .innerJoin(tools, eq(endpointTools.toolId, tools.id))
      .where(eq(tools.sourceId, sourceId));

    return rows.map((row) => row.endpointId);
  },
});
