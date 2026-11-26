import type { ToolAnnotations, ToolCachePolicy } from "@mux/core/types";

export interface ToolItem {
  id: string;
  sourceId: string;
  name: string;
  slug: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  cachePolicy: ToolCachePolicy;
  schemaHash: string;
  enabled: boolean;
  updatedAt: string;
}

export interface UpdateToolInput {
  id: string;
  enabled?: boolean;
  cachePolicy?: ToolCachePolicy;
}
