import type { ToolSourceConfig, ToolSourceKind, ToolSourceStatus } from "@mux/core/types";

export interface SourceItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: ToolSourceKind;
  status: ToolSourceStatus;
  config: ToolSourceConfig;
  hasSecrets: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface LocalPluginItem {
  directoryName: string;
  name: string;
  version: string;
  description: string | null;
  entry: string;
  requiredSecrets: string[];
  toolCount: number;
}

export interface RegisterMcpInput {
  slug: string;
  name: string;
  description?: string;
  url: string;
  headers?: Record<string, string>;
}

export interface RegisterMcpResult {
  source: SourceItem;
  syncedToolsCount: number;
  syncError: string | null;
}

export interface RegisterLocalPluginInput {
  directoryName: string;
  slug?: string;
  name?: string;
  secrets?: Record<string, string>;
}

export interface UploadPluginInput {
  slug?: string;
  name?: string;
  manifest: Record<string, unknown>;
  files: Array<{ path: string; content: string }>;
  secrets?: Record<string, string>;
}
