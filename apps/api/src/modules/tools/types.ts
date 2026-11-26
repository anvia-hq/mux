import type { ToolCache } from "@mux/core/cache/types";
import type { CanonicalTool, ToolAnnotations, ToolCachePolicy } from "@mux/core/types";
import type { SessionResolver } from "../../auth";

export interface ToolRecord {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertSyncedToolInput {
  name: string;
  slug: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  defaultCachePolicy: ToolCachePolicy;
  schemaHash: string;
}

export interface UpdateToolInput {
  enabled?: boolean;
  cachePolicy?: ToolCachePolicy;
}

export interface ToolsRepository {
  list: (sourceId?: string) => Promise<ToolRecord[]>;
  findById: (id: string) => Promise<ToolRecord | null>;
  findBySlug: (slug: string) => Promise<ToolRecord | null>;
  syncSourceTools: (sourceId: string, items: UpsertSyncedToolInput[]) => Promise<ToolRecord[]>;
  update: (id: string, input: UpdateToolInput) => Promise<ToolRecord | null>;
  listEndpointIdsForTool: (toolId: string) => Promise<string[]>;
  listCanonicalToolsForEndpoint: (endpointId: string) => Promise<CanonicalTool[]>;
}

export interface ToolsService {
  list: (sourceId?: string) => Promise<ToolRecord[]>;
  getById: (id: string) => Promise<ToolRecord>;
  update: (id: string, input: UpdateToolInput) => Promise<ToolRecord>;
  invalidateToolCache: (id: string) => Promise<number>;
  invalidateTagCache: (tag: string) => Promise<number>;
}

export interface ToolsServiceDeps {
  toolsRepo: ToolsRepository;
  toolCache: Pick<ToolCache, "invalidateEndpointCatalog" | "invalidateTag" | "invalidateTool">;
  onCacheError?: (error: unknown, key: string) => void;
}

export interface ToolsRouterDeps {
  sessionResolver: SessionResolver;
  toolsService: ToolsService;
}
