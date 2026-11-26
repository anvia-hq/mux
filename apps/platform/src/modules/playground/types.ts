import type { ToolCacheStatus, ToolExecutionResult, ToolExecutionStatus } from "@mux/core/types";

export interface ExecutionLogItem {
  id: string;
  toolId: string | null;
  toolSlug: string;
  endpointId: string | null;
  status: ToolExecutionStatus;
  cacheStatus: ToolCacheStatus;
  durationMs: number;
  argsSummary: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface PlaygroundExecuteInput {
  toolId: string;
  arguments: Record<string, unknown>;
  bypassCache: boolean;
}

export interface PlaygroundExecuteOutput {
  result: ToolExecutionResult;
  cacheStatus: ToolCacheStatus;
  durationMs: number;
}
