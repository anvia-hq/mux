export type UserRole = "admin" | "member";

export type ToolSourceKind = "mcp_remote" | "plugin_code";

export type ToolSourceStatus = "active" | "disabled" | "error";

export type EndpointMode = "direct" | "router";

export type ToolCacheMode = "off" | "ttl" | "stale_while_revalidate";

export type ToolCacheStatus = "hit" | "miss" | "stale" | "bypass" | "disabled";

export type ToolExecutionStatus = "success" | "error";

export interface ToolCachePolicy {
  mode: ToolCacheMode;
  ttlSeconds: number;
  staleSeconds?: number;
  maxPayloadBytes?: number;
  tags?: string[];
  allowBypass?: boolean;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint?: boolean;
}

export interface McpRemoteConfig {
  kind: "mcp_remote";
  url: string;
  transport: "streamable_http" | "sse";
  timeoutMs?: number;
}

export interface PluginCodeConfig {
  kind: "plugin_code";
  origin: "local" | "uploaded";
  directoryName: string;
  entry: string;
  version: string;
  timeoutMs: number;
  requiredSecrets: string[];
  toolHandlers: Record<string, string>;
  bundleHash?: string;
}

export type ToolSourceConfig = McpRemoteConfig | PluginCodeConfig;

export interface ToolContentBlock {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
}

export interface ToolExecutionResult {
  content: ToolContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface CanonicalTool {
  id: string;
  sourceId: string;
  sourceSlug: string;
  sourceKind: ToolSourceKind;
  name: string;
  slug: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  cachePolicy: ToolCachePolicy;
  schemaHash: string;
  enabled: boolean;
}

export interface SecretVault {
  encrypt: (plaintext: string) => string;
  decrypt: (token: string) => string;
  encryptJson: (value: unknown) => string;
  decryptJson: <T>(token: string, parse: (value: unknown) => T) => T;
}

export interface GeneratedApiKey {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
}

export interface JsonSchemaValidationResult {
  valid: boolean;
  errors: string[];
}
