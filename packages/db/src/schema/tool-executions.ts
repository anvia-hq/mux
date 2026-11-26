import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apiKeys } from "./api-keys";
import { endpoints } from "./endpoints";
import { toolSources } from "./tool-sources";
import { tools } from "./tools";
import { users } from "./users";

export const cacheStatusEnum = pgEnum("cache_status", [
  "hit",
  "miss",
  "stale",
  "bypass",
  "disabled",
]);

export const executionStatusEnum = pgEnum("execution_status", ["success", "error"]);

export const toolExecutions = pgTable(
  "tool_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "set null" }),
    toolSlug: text("tool_slug").notNull(),
    sourceId: uuid("source_id").references(() => toolSources.id, { onDelete: "set null" }),
    endpointId: uuid("endpoint_id").references(() => endpoints.id, { onDelete: "set null" }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    status: executionStatusEnum("status").notNull(),
    cacheStatus: cacheStatusEnum("cache_status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    argsSummary: jsonb("args_summary").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tool_executions_created_at_idx").on(table.createdAt),
    index("tool_executions_tool_id_idx").on(table.toolId),
    index("tool_executions_endpoint_id_idx").on(table.endpointId),
  ],
);
