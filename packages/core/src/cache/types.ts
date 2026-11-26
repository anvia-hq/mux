import type {
  CanonicalTool,
  ToolCachePolicy,
  ToolCacheStatus,
  ToolExecutionResult,
} from "../types";

export interface RedisBackend {
  get: (key: string) => Promise<string | null>;
  setEx: (key: string, value: string, ttlSeconds: number) => Promise<void>;
  del: (keys: string[]) => Promise<number>;
  sadd: (key: string, members: string[]) => Promise<number>;
  smembers: (key: string) => Promise<string[]>;
  expire: (key: string, ttlSeconds: number) => Promise<void>;
}

export interface BuildToolCacheKeyInput {
  prefix?: string;
  toolId: string;
  schemaHash: string;
  args: Record<string, unknown>;
  scopeKey?: string;
}

export interface ExecuteWithCacheInput {
  toolId: string;
  schemaHash: string;
  args: Record<string, unknown>;
  policy: ToolCachePolicy;
  scopeKey?: string;
  bypass?: boolean;
  execute: () => Promise<ToolExecutionResult>;
}

export interface ExecuteWithCacheOutput {
  result: ToolExecutionResult;
  cacheStatus: ToolCacheStatus;
  cacheKey?: string;
}

export interface ToolCacheOptions {
  keyPrefix?: string;
  defaultMaxPayloadBytes?: number;
  defaultCatalogTtlSeconds?: number;
  now?: () => number;
  onBackgroundError?: (error: unknown, cacheKey: string) => void;
}

export interface ToolCache {
  executeWithCache: (input: ExecuteWithCacheInput) => Promise<ExecuteWithCacheOutput>;
  invalidateTool: (toolId: string) => Promise<number>;
  invalidateTag: (tag: string) => Promise<number>;
  getEndpointCatalog: (endpointId: string) => Promise<CanonicalTool[] | null>;
  setEndpointCatalog: (
    endpointId: string,
    tools: CanonicalTool[],
    ttlSeconds?: number,
  ) => Promise<void>;
  invalidateEndpointCatalog: (endpointId: string) => Promise<number>;
  flushPendingRevalidations: () => Promise<void>;
}
