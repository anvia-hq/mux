import type { Database } from "@mux/db";
import { toolExecutions } from "@mux/db/schema/tool-executions";
import { and, desc, eq, type SQL } from "drizzle-orm";
import type {
  ExecutionsRepository,
  InsertExecutionData,
  ListExecutionsFilter,
  ToolExecutionRecord,
} from "./types";

export const createDrizzleExecutionsRepository = (db: Database): ExecutionsRepository => ({
  insert: async (data: InsertExecutionData): Promise<ToolExecutionRecord> => {
    const rows = await db.insert(toolExecutions).values(data).returning();
    const inserted = rows[0];

    if (!inserted) {
      throw new Error("Failed to insert tool execution record.");
    }

    return inserted;
  },

  list: async (filter: ListExecutionsFilter): Promise<ToolExecutionRecord[]> => {
    const conditions: SQL[] = [];

    if (filter.toolId) {
      conditions.push(eq(toolExecutions.toolId, filter.toolId));
    }

    if (filter.endpointId) {
      conditions.push(eq(toolExecutions.endpointId, filter.endpointId));
    }

    if (conditions.length === 0) {
      return db
        .select()
        .from(toolExecutions)
        .orderBy(desc(toolExecutions.createdAt))
        .limit(filter.limit);
    }

    return db
      .select()
      .from(toolExecutions)
      .where(and(...conditions))
      .orderBy(desc(toolExecutions.createdAt))
      .limit(filter.limit);
  },
});
