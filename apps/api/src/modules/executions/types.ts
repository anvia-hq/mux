import type { ToolCache } from "@mux/core/cache/types";
import type {
  CanonicalTool,
  SecretVault,
  ToolCachePolicy,
  ToolCacheStatus,
  ToolExecutionResult,
  ToolExecutionStatus,
  ToolSourceKind,
} from "@mux/core/types";
import type { UpstreamMcpClient } from "@mux/mcp/types";
import type { SessionResolver } from "../../auth";
import type { SourcesRepository, ToolSourceRecord } from "../sources/types";
import type { ToolsRepository } from "../tools/types";

export interface ToolExecutionRecord {
  id: string;
  toolId: string | null;
  toolSlug: string;
  sourceId: string | null;
  endpointId: string | null;
  apiKeyId: string | null;
  userId: string | null;
  status: ToolExecutionStatus;
  cacheStatus: ToolCacheStatus;
  durationMs: number;
  argsSummary: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface InsertExecutionData {
  toolId: string | null;
  toolSlug: string;
  sourceId: string | null;
  endpointId: string | null;
  apiKeyId: string | null;
  userId: string | null;
  status: ToolExecutionStatus;
  cacheStatus: ToolCacheStatus;
  durationMs: number;
  argsSummary: Record<string, unknown> | null;
  errorMessage: string | null;
}

export interface ListExecutionsFilter {
  toolId?: string;
  endpointId?: string;
  limit: number;
}

export interface ToolSourceExecutor {
  execute: (input: {
    source: ToolSourceRecord;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<ToolExecutionResult>;
}

export interface ExecuteToolInput {
  toolId: string;
  args: Record<string, unknown>;
  bypassCache?: boolean;
  cachePolicyOverride?: ToolCachePolicy | null;
  endpointId?: string;
  apiKeyId?: string;
  userId?: string;
}

export interface ExecuteCanonicalToolInput {
  tool: CanonicalTool;
  args: Record<string, unknown>;
  bypassCache?: boolean;
  endpointId?: string;
  apiKeyId?: string;
  userId?: string;
}

export interface ExecuteToolOutput {
  result: ToolExecutionResult;
  cacheStatus: ToolCacheStatus;
  durationMs: number;
}

export interface ExecutionsRepository {
  insert: (data: InsertExecutionData) => Promise<ToolExecutionRecord>;
  list: (filter: ListExecutionsFilter) => Promise<ToolExecutionRecord[]>;
}

export interface ToolExecutionService {
  executeByToolId: (input: ExecuteToolInput) => Promise<ExecuteToolOutput>;
  executeCanonical: (input: ExecuteCanonicalToolInput) => Promise<ExecuteToolOutput>;
  listExecutions: (filter: ListExecutionsFilter) => Promise<ToolExecutionRecord[]>;
}

export interface ToolExecutionServiceDeps {
  executionsRepo: ExecutionsRepository;
  sourcesRepo: Pick<SourcesRepository, "findById">;
  toolsRepo: Pick<ToolsRepository, "findById">;
  toolCache: Pick<ToolCache, "executeWithCache">;
  executors: Partial<Record<ToolSourceKind, ToolSourceExecutor>>;
  now?: () => number;
  onAuditError?: (error: unknown) => void;
}

export interface McpExecutorDeps {
  mcpClient: UpstreamMcpClient;
  secretVault: SecretVault;
}

export interface ExecutionsRouterDeps {
  sessionResolver: SessionResolver;
  executionService: ToolExecutionService;
}
