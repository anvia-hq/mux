import type { ToolCachePolicy } from "@mux/core/types";
import type { Database } from "@mux/db";
import { endpointTools } from "@mux/db/schema/endpoint-tools";
import { endpoints } from "@mux/db/schema/endpoints";
import { tools } from "@mux/db/schema/tools";
import { and, asc, desc, eq } from "drizzle-orm";
import { ConflictError } from "../../errors";
import type {
  EndpointRecord,
  EndpointToolRecord,
  EndpointsRepository,
  InsertEndpointData,
  UpdateEndpointInput,
} from "./types";

const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error && error.code === "23505") {
    return true;
  }

  if ("cause" in error && typeof error.cause === "object" && error.cause !== null) {
    return "code" in error.cause && error.cause.code === "23505";
  }

  return false;
};

export const createDrizzleEndpointsRepository = (db: Database): EndpointsRepository => ({
  list: async (): Promise<EndpointRecord[]> =>
    db.select().from(endpoints).orderBy(desc(endpoints.createdAt)),

  findById: async (id: string): Promise<EndpointRecord | null> => {
    const rows = await db.select().from(endpoints).where(eq(endpoints.id, id)).limit(1);

    return rows[0] ?? null;
  },

  findBySlug: async (slug: string): Promise<EndpointRecord | null> => {
    const rows = await db.select().from(endpoints).where(eq(endpoints.slug, slug)).limit(1);

    return rows[0] ?? null;
  },

  insert: async (data: InsertEndpointData): Promise<EndpointRecord> => {
    try {
      const rows = await db.insert(endpoints).values(data).returning();

      return rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Endpoint slug '${data.slug}' already exists.`);
      }

      throw error;
    }
  },

  update: async (id: string, input: UpdateEndpointInput): Promise<EndpointRecord | null> => {
    const patch: Partial<typeof endpoints.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) {
      patch.name = input.name;
    }

    if (input.description !== undefined) {
      patch.description = input.description;
    }

    if (input.mode !== undefined) {
      patch.mode = input.mode;
    }

    if (input.enabled !== undefined) {
      patch.enabled = input.enabled;
    }

    const rows = await db.update(endpoints).set(patch).where(eq(endpoints.id, id)).returning();

    return rows[0] ?? null;
  },

  remove: async (id: string): Promise<boolean> => {
    const rows = await db
      .delete(endpoints)
      .where(eq(endpoints.id, id))
      .returning({ id: endpoints.id });

    return rows.length > 0;
  },

  listTools: async (endpointId: string): Promise<EndpointToolRecord[]> =>
    db
      .select()
      .from(endpointTools)
      .where(eq(endpointTools.endpointId, endpointId))
      .orderBy(asc(endpointTools.createdAt)),

  toolExists: async (toolId: string): Promise<boolean> => {
    const rows = await db.select({ id: tools.id }).from(tools).where(eq(tools.id, toolId)).limit(1);

    return rows.length > 0;
  },

  upsertTool: async (
    endpointId: string,
    toolId: string,
    input: { enabled: boolean; cachePolicyOverride: ToolCachePolicy | null },
  ): Promise<EndpointToolRecord> => {
    const now = new Date();
    const rows = await db
      .insert(endpointTools)
      .values({
        endpointId,
        toolId,
        enabled: input.enabled,
        cachePolicyOverride: input.cachePolicyOverride,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [endpointTools.endpointId, endpointTools.toolId],
        set: {
          enabled: input.enabled,
          cachePolicyOverride: input.cachePolicyOverride,
          updatedAt: now,
        },
      })
      .returning();

    return rows[0];
  },

  removeTool: async (endpointId: string, toolId: string): Promise<boolean> => {
    const rows = await db
      .delete(endpointTools)
      .where(and(eq(endpointTools.endpointId, endpointId), eq(endpointTools.toolId, toolId)))
      .returning({ id: endpointTools.id });

    return rows.length > 0;
  },
});
