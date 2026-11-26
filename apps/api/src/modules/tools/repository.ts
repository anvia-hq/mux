import { randomUUID } from "node:crypto";
import type { CanonicalTool } from "@mux/core/types";
import type { Database } from "@mux/db";
import { endpointTools } from "@mux/db/schema/endpoint-tools";
import { toolSources } from "@mux/db/schema/tool-sources";
import { tools } from "@mux/db/schema/tools";
import { and, asc, eq, notInArray } from "drizzle-orm";
import type { ToolRecord, ToolsRepository, UpdateToolInput, UpsertSyncedToolInput } from "./types";

export const createDrizzleToolsRepository = (db: Database): ToolsRepository => ({
  list: async (sourceId?: string): Promise<ToolRecord[]> => {
    if (sourceId) {
      return db.select().from(tools).where(eq(tools.sourceId, sourceId)).orderBy(asc(tools.slug));
    }

    return db.select().from(tools).orderBy(asc(tools.slug));
  },

  findById: async (id: string): Promise<ToolRecord | null> => {
    const rows = await db.select().from(tools).where(eq(tools.id, id)).limit(1);

    return rows[0] ?? null;
  },

  findBySlug: async (slug: string): Promise<ToolRecord | null> => {
    const rows = await db.select().from(tools).where(eq(tools.slug, slug)).limit(1);

    return rows[0] ?? null;
  },

  syncSourceTools: async (
    sourceId: string,
    items: UpsertSyncedToolInput[],
  ): Promise<ToolRecord[]> =>
    db.transaction(async (tx) => {
      const now = new Date();
      const names = items.map((item) => item.name);

      if (names.length === 0) {
        await tx.delete(tools).where(eq(tools.sourceId, sourceId));

        return [];
      }

      await tx
        .delete(tools)
        .where(and(eq(tools.sourceId, sourceId), notInArray(tools.name, names)));

      const existingRows = await tx.select().from(tools).where(eq(tools.sourceId, sourceId));
      const existingByName = new Map(existingRows.map((row) => [row.name, row]));

      for (const item of items) {
        const existing = existingByName.get(item.name);

        if (existing && existing.slug !== item.slug) {
          await tx
            .update(tools)
            .set({ slug: `__tmp_${randomUUID()}` })
            .where(eq(tools.id, existing.id));
        }
      }

      const synced: ToolRecord[] = [];

      for (const item of items) {
        const rows = await tx
          .insert(tools)
          .values({
            sourceId,
            name: item.name,
            slug: item.slug,
            description: item.description,
            inputSchema: item.inputSchema,
            annotations: item.annotations,
            cachePolicy: item.defaultCachePolicy,
            schemaHash: item.schemaHash,
            enabled: true,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [tools.sourceId, tools.name],
            set: {
              slug: item.slug,
              description: item.description,
              inputSchema: item.inputSchema,
              annotations: item.annotations,
              schemaHash: item.schemaHash,
              updatedAt: now,
            },
          })
          .returning();
        const saved = rows[0];

        if (saved) {
          synced.push(saved);
        }
      }

      return synced;
    }),

  update: async (id: string, input: UpdateToolInput): Promise<ToolRecord | null> => {
    const patch: Partial<typeof tools.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.enabled !== undefined) {
      patch.enabled = input.enabled;
    }

    if (input.cachePolicy !== undefined) {
      patch.cachePolicy = input.cachePolicy;
    }

    const rows = await db.update(tools).set(patch).where(eq(tools.id, id)).returning();

    return rows[0] ?? null;
  },

  listEndpointIdsForTool: async (toolId: string): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ endpointId: endpointTools.endpointId })
      .from(endpointTools)
      .where(eq(endpointTools.toolId, toolId));

    return rows.map((row) => row.endpointId);
  },

  listCanonicalToolsForEndpoint: async (endpointId: string): Promise<CanonicalTool[]> => {
    const rows = await db
      .select({
        tool: tools,
        sourceSlug: toolSources.slug,
        sourceKind: toolSources.kind,
        cachePolicyOverride: endpointTools.cachePolicyOverride,
      })
      .from(endpointTools)
      .innerJoin(tools, eq(endpointTools.toolId, tools.id))
      .innerJoin(toolSources, eq(tools.sourceId, toolSources.id))
      .where(
        and(
          eq(endpointTools.endpointId, endpointId),
          eq(endpointTools.enabled, true),
          eq(tools.enabled, true),
          eq(toolSources.status, "active"),
        ),
      )
      .orderBy(asc(tools.slug));

    return rows.map((row) => ({
      id: row.tool.id,
      sourceId: row.tool.sourceId,
      sourceSlug: row.sourceSlug,
      sourceKind: row.sourceKind,
      name: row.tool.name,
      slug: row.tool.slug,
      description: row.tool.description,
      inputSchema: row.tool.inputSchema,
      annotations: row.tool.annotations,
      cachePolicy: row.cachePolicyOverride ?? row.tool.cachePolicy,
      schemaHash: row.tool.schemaHash,
      enabled: row.tool.enabled,
    }));
  },
});
