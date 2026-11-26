import type { ToolAnnotations, ToolCachePolicy } from "@mux/core/types";
import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { toolSources } from "./tool-sources";

export const tools = pgTable(
  "tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => toolSources.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    inputSchema: jsonb("input_schema").$type<Record<string, unknown>>().notNull(),
    annotations: jsonb("annotations").$type<ToolAnnotations>().notNull(),
    cachePolicy: jsonb("cache_policy").$type<ToolCachePolicy>().notNull(),
    schemaHash: text("schema_hash").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("tools_source_id_name_idx").on(table.sourceId, table.name)],
);
