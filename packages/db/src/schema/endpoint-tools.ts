import type { ToolCachePolicy } from "@mux/core/types";
import { boolean, jsonb, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { endpoints } from "./endpoints";
import { tools } from "./tools";

export const endpointTools = pgTable(
  "endpoint_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoints.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    cachePolicyOverride: jsonb("cache_policy_override").$type<ToolCachePolicy | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("endpoint_tools_endpoint_id_tool_id_idx").on(table.endpointId, table.toolId),
  ],
);
