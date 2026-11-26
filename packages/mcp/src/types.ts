import type {
  CanonicalTool,
  EndpointMode,
  ToolAnnotations,
  ToolCacheStatus,
  ToolExecutionResult,
} from "@mux/core/types";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface DiscoveredMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
}

export interface UpstreamMcpTarget {
  url: string;
  transport: "streamable_http" | "sse";
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface UpstreamMcpClient {
  listTools: (target: UpstreamMcpTarget) => Promise<DiscoveredMcpTool[]>;
  callTool: (
    target: UpstreamMcpTarget,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<ToolExecutionResult>;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface UpstreamMcpClientOptions {
  fetchImpl?: FetchLike;
  defaultTimeoutMs?: number;
  maxResponseBytes?: number;
}

export interface GatewayExecutionOutcome {
  result: ToolExecutionResult;
  cacheStatus: ToolCacheStatus;
  durationMs: number;
}

export interface McpGatewayContext {
  endpointSlug: string;
  mode: EndpointMode;
  tools: CanonicalTool[];
  executeTool: (input: {
    toolSlug: string;
    args: Record<string, unknown>;
    bypassCache: boolean;
  }) => Promise<GatewayExecutionOutcome>;
}

export interface McpGatewayHttpResult {
  status: number;
  body: JsonRpcResponse | null;
}
