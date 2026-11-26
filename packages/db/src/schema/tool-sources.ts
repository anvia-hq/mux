import type { ToolSourceConfig } from "@mux/core/types";
import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const toolSourceKindEnum = pgEnum("tool_source_kind", ["mcp_remote", "plugin_code"]);

export const toolSourceStatusEnum = pgEnum("tool_source_status", ["active", "disabled", "error"]);

export const toolSources = pgTable("tool_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  kind: toolSourceKindEnum("kind").notNull(),
  status: toolSourceStatusEnum("status").notNull().default("active"),
  config: jsonb("config").$type<ToolSourceConfig>().notNull(),
  encryptedSecrets: text("encrypted_secrets"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
