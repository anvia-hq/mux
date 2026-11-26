import type { ToolCache } from "@mux/core/cache/types";
import type {
  SecretVault,
  ToolSourceConfig,
  ToolSourceKind,
  ToolSourceStatus,
} from "@mux/core/types";
import type { UpstreamMcpClient } from "@mux/mcp/types";
import type { PluginRuntime, UploadedPluginFile } from "@mux/plugins/types";
import type { AuthenticatedUser, SessionResolver } from "../../auth";
import type { ToolsRepository } from "../tools/types";

export interface ToolSourceRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: ToolSourceKind;
  status: ToolSourceStatus;
  config: ToolSourceConfig;
  encryptedSecrets: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicToolSource {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: ToolSourceKind;
  status: ToolSourceStatus;
  config: ToolSourceConfig;
  hasSecrets: boolean;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscoverableLocalPlugin {
  directoryName: string;
  name: string;
  version: string;
  description: string | null;
  entry: string;
  requiredSecrets: string[];
  toolCount: number;
}

export interface CreateMcpSourceInput {
  slug: string;
  name: string;
  description?: string | null;
  url: string;
  transport?: "streamable_http";
  timeoutMs?: number;
  headers?: Record<string, string>;
  autoSync?: boolean;
}

export interface RegisterLocalPluginInput {
  directoryName: string;
  slug?: string;
  name?: string;
  description?: string | null;
  secrets?: Record<string, string>;
}

export interface UploadPluginInput {
  slug?: string;
  name?: string;
  description?: string | null;
  manifest: Record<string, unknown>;
  files: UploadedPluginFile[];
  secrets?: Record<string, string>;
}

export interface UpdateSourceInput {
  name?: string;
  description?: string | null;
  status?: "active" | "disabled";
  url?: string;
  transport?: "streamable_http";
  timeoutMs?: number;
  headers?: Record<string, string> | null;
  secrets?: Record<string, string> | null;
}

export interface InsertSourceData {
  slug: string;
  name: string;
  description: string | null;
  kind: ToolSourceKind;
  status: ToolSourceStatus;
  config: ToolSourceConfig;
  encryptedSecrets: string | null;
  createdById: string;
}

export interface UpdateSourceData {
  name?: string;
  description?: string | null;
  status?: ToolSourceStatus;
  config?: ToolSourceConfig;
  encryptedSecrets?: string | null;
  lastSyncedAt?: Date | null;
  lastError?: string | null;
}

export interface SyncSourceResult {
  source: PublicToolSource;
  syncedToolsCount: number;
}

export interface CreateMcpSourceResult {
  source: PublicToolSource;
  syncedToolsCount: number;
  syncError: string | null;
}

export interface RegisterPluginResult {
  source: PublicToolSource;
  syncedToolsCount: number;
}

export interface SourcesRepository {
  list: () => Promise<ToolSourceRecord[]>;
  findById: (id: string) => Promise<ToolSourceRecord | null>;
  findBySlug: (slug: string) => Promise<ToolSourceRecord | null>;
  insert: (data: InsertSourceData) => Promise<ToolSourceRecord>;
  update: (id: string, data: UpdateSourceData) => Promise<ToolSourceRecord | null>;
  remove: (id: string) => Promise<boolean>;
  listAffectedEndpointIds: (sourceId: string) => Promise<string[]>;
}

export interface SourcesService {
  list: () => Promise<PublicToolSource[]>;
  getById: (id: string) => Promise<PublicToolSource>;
  listLocalPlugins: () => Promise<DiscoverableLocalPlugin[]>;
  createMcpSource: (
    actor: AuthenticatedUser,
    input: CreateMcpSourceInput,
  ) => Promise<CreateMcpSourceResult>;
  registerLocalPlugin: (
    actor: AuthenticatedUser,
    input: RegisterLocalPluginInput,
  ) => Promise<RegisterPluginResult>;
  uploadPlugin: (
    actor: AuthenticatedUser,
    input: UploadPluginInput,
  ) => Promise<RegisterPluginResult>;
  update: (id: string, input: UpdateSourceInput) => Promise<PublicToolSource>;
  remove: (id: string) => Promise<void>;
  syncSource: (id: string) => Promise<SyncSourceResult>;
}

export interface SourcesServiceDeps {
  sourcesRepo: SourcesRepository;
  toolsRepo: Pick<ToolsRepository, "list" | "syncSourceTools">;
  secretVault: SecretVault;
  mcpClient: UpstreamMcpClient;
  pluginRuntime: PluginRuntime;
  toolCache: Pick<ToolCache, "invalidateEndpointCatalog" | "invalidateTool">;
  onCacheError?: (error: unknown, key: string) => void;
}

export interface SourcesRouterDeps {
  sessionResolver: SessionResolver;
  sourcesService: SourcesService;
}
