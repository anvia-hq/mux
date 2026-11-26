import { createDefaultCachePolicy } from "@mux/core/cache/schema";
import { computeSchemaHash } from "@mux/core/canonical-json";
import { buildToolSlug } from "@mux/core/manifest";
import type { McpRemoteConfig, PluginCodeConfig } from "@mux/core/types";
import { assertSafeUpstreamUrl } from "@mux/mcp/upstream-client";
import type { LoadedPlugin } from "@mux/plugins/types";
import type { AuthenticatedUser } from "../../auth";
import { ConflictError, NotFoundError, UnavailableError, UnprocessableError } from "../../errors";
import type { UpsertSyncedToolInput } from "../tools/types";
import { decryptMcpHeaders } from "./secrets";
import type {
  CreateMcpSourceInput,
  CreateMcpSourceResult,
  DiscoverableLocalPlugin,
  PublicToolSource,
  RegisterLocalPluginInput,
  RegisterPluginResult,
  SourcesService,
  SourcesServiceDeps,
  SyncSourceResult,
  ToolSourceRecord,
  UpdateSourceData,
  UpdateSourceInput,
  UploadPluginInput,
} from "./types";

const sanitizeToolSlugSegment = (rawName: string): string => {
  const normalized = rawName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "tool";
};

const buildPluginConfig = (loaded: LoadedPlugin): PluginCodeConfig => {
  const toolHandlers: Record<string, string> = {};

  for (const tool of loaded.manifest.tools) {
    toolHandlers[tool.name] = tool.handler;
  }

  return {
    kind: "plugin_code",
    origin: loaded.origin,
    directoryName: loaded.directoryName,
    entry: loaded.manifest.entry,
    version: loaded.manifest.version,
    timeoutMs: loaded.manifest.timeoutMs,
    requiredSecrets: loaded.manifest.secrets,
    toolHandlers,
    bundleHash: loaded.bundleHash,
  };
};

const buildPluginSyncedTools = (
  sourceSlug: string,
  loaded: LoadedPlugin,
): UpsertSyncedToolInput[] =>
  loaded.manifest.tools.map((tool) => ({
    name: tool.name,
    slug: buildToolSlug(sourceSlug, tool.name),
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: tool.readOnly,
      destructiveHint: tool.destructive,
      idempotentHint: tool.idempotent,
    },
    defaultCachePolicy: tool.cache ?? createDefaultCachePolicy(),
    schemaHash: computeSchemaHash(tool.inputSchema),
  }));

export const toPublicToolSource = (record: ToolSourceRecord): PublicToolSource => ({
  id: record.id,
  slug: record.slug,
  name: record.name,
  description: record.description,
  kind: record.kind,
  status: record.status,
  config: record.config,
  hasSecrets: record.encryptedSecrets !== null,
  lastSyncedAt: record.lastSyncedAt,
  lastError: record.lastError,
  createdById: record.createdById,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export const createSourcesService = ({
  sourcesRepo,
  toolsRepo,
  secretVault,
  mcpClient,
  pluginRuntime,
  toolCache,
  onCacheError,
}: SourcesServiceDeps): SourcesService => {
  const reportCacheError = (error: unknown, key: string): void => {
    if (!onCacheError) {
      return;
    }

    try {
      onCacheError(error, key);
    } catch {
      void error;
    }
  };

  const invalidateEndpoints = async (endpointIds: string[]): Promise<void> => {
    await Promise.allSettled(
      endpointIds.map(async (endpointId) => {
        try {
          await toolCache.invalidateEndpointCatalog(endpointId);
        } catch (error) {
          reportCacheError(error, endpointId);
        }
      }),
    );
  };

  const invalidateTools = async (toolIds: string[]): Promise<void> => {
    await Promise.allSettled(
      toolIds.map(async (toolId) => {
        try {
          await toolCache.invalidateTool(toolId);
        } catch (error) {
          reportCacheError(error, toolId);
        }
      }),
    );
  };

  const syncMcpSourceInternal = async (source: ToolSourceRecord): Promise<SyncSourceResult> => {
    if (source.kind !== "mcp_remote" || source.config.kind !== "mcp_remote") {
      throw new UnprocessableError("Only remote MCP sources can be synced via MCP discovery.");
    }

    const affectedEndpoints = await sourcesRepo.listAffectedEndpointIds(source.id);

    try {
      const headers = decryptMcpHeaders(secretVault, source.encryptedSecrets);
      const discovered = await mcpClient.listTools({
        url: source.config.url,
        transport: source.config.transport,
        headers,
        timeoutMs: source.config.timeoutMs,
      });

      const dedupedByName = new Map<string, (typeof discovered)[number]>();

      for (const tool of discovered) {
        if (!dedupedByName.has(tool.name)) {
          dedupedByName.set(tool.name, tool);
        }
      }

      const existingTools = await toolsRepo.list(source.id);
      const existingByName = new Map(existingTools.map((item) => [item.name, item]));
      const usedSlugs = new Set<string>();

      for (const existingTool of existingTools) {
        if (dedupedByName.has(existingTool.name)) {
          usedSlugs.add(existingTool.slug);
        }
      }

      const syncedItems: UpsertSyncedToolInput[] = [];

      for (const tool of dedupedByName.values()) {
        const existingTool = existingByName.get(tool.name);
        let slug: string;

        if (existingTool) {
          slug = existingTool.slug;
        } else {
          const baseSegment = sanitizeToolSlugSegment(tool.name);

          slug = buildToolSlug(source.slug, baseSegment);

          let suffix = 2;

          while (usedSlugs.has(slug)) {
            slug = buildToolSlug(source.slug, `${baseSegment}_${suffix}`);
            suffix += 1;
          }

          usedSlugs.add(slug);
        }

        syncedItems.push({
          name: tool.name,
          slug,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          defaultCachePolicy: createDefaultCachePolicy(),
          schemaHash: computeSchemaHash(tool.inputSchema),
        });
      }

      const removedToolIds: string[] = [];

      for (const existingTool of existingTools) {
        if (!dedupedByName.has(existingTool.name)) {
          removedToolIds.push(existingTool.id);
        }
      }

      await toolsRepo.syncSourceTools(source.id, syncedItems);

      const updated = await sourcesRepo.update(source.id, {
        status: source.status === "disabled" ? "disabled" : "active",
        lastSyncedAt: new Date(),
        lastError: null,
      });

      await invalidateTools(removedToolIds);
      await invalidateEndpoints(affectedEndpoints);

      return {
        source: toPublicToolSource(updated ?? source),
        syncedToolsCount: syncedItems.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync upstream MCP.";

      await sourcesRepo.update(source.id, {
        status: source.status === "disabled" ? "disabled" : "error",
        lastError: message,
      });
      await invalidateEndpoints(affectedEndpoints);

      throw new UnavailableError(`Failed to sync MCP source '${source.slug}'.`);
    }
  };

  const syncLocalPluginInternal = async (source: ToolSourceRecord): Promise<SyncSourceResult> => {
    if (source.config.kind !== "plugin_code") {
      throw new UnprocessableError("Source is not a code plugin.");
    }

    if (source.config.origin !== "local") {
      throw new UnprocessableError("Uploaded plugins are updated by uploading a new bundle.");
    }

    const affectedEndpoints = await sourcesRepo.listAffectedEndpointIds(source.id);

    try {
      const loaded = await pluginRuntime.loadLocalPlugin(source.config.directoryName);
      const syncedItems = buildPluginSyncedTools(source.slug, loaded);
      const existingTools = await toolsRepo.list(source.id);
      const incomingNames = new Set(syncedItems.map((item) => item.name));
      const removedToolIds: string[] = [];

      for (const existingTool of existingTools) {
        if (!incomingNames.has(existingTool.name)) {
          removedToolIds.push(existingTool.id);
        }
      }

      await toolsRepo.syncSourceTools(source.id, syncedItems);

      const nextConfig = buildPluginConfig(loaded);
      const updated = await sourcesRepo.update(source.id, {
        config: nextConfig,
        status: source.status === "disabled" ? "disabled" : "active",
        lastSyncedAt: new Date(),
        lastError: null,
      });

      await invalidateTools(removedToolIds);
      await invalidateEndpoints(affectedEndpoints);

      return {
        source: toPublicToolSource(updated ?? source),
        syncedToolsCount: syncedItems.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reload local plugin.";

      await sourcesRepo.update(source.id, {
        status: source.status === "disabled" ? "disabled" : "error",
        lastError: message,
      });
      await invalidateEndpoints(affectedEndpoints);

      throw new UnprocessableError(`Failed to sync local plugin '${source.slug}': ${message}`);
    }
  };

  return {
    list: async (): Promise<PublicToolSource[]> => {
      const rows = await sourcesRepo.list();

      return rows.map(toPublicToolSource);
    },

    getById: async (id: string): Promise<PublicToolSource> => {
      const source = await sourcesRepo.findById(id);

      if (!source) {
        throw new NotFoundError("Tool source not found.");
      }

      return toPublicToolSource(source);
    },

    listLocalPlugins: async (): Promise<DiscoverableLocalPlugin[]> => {
      const loaded = await pluginRuntime.listLocalPlugins();

      return loaded.map((item) => ({
        directoryName: item.directoryName,
        name: item.manifest.name,
        version: item.manifest.version,
        description: item.manifest.description ?? null,
        entry: item.manifest.entry,
        requiredSecrets: item.manifest.secrets,
        toolCount: item.manifest.tools.length,
      }));
    },

    createMcpSource: async (
      actor: AuthenticatedUser,
      input: CreateMcpSourceInput,
    ): Promise<CreateMcpSourceResult> => {
      assertSafeUpstreamUrl(input.url);

      const existing = await sourcesRepo.findBySlug(input.slug);

      if (existing) {
        throw new ConflictError(`Tool source slug '${input.slug}' already exists.`);
      }

      const config: McpRemoteConfig = {
        kind: "mcp_remote",
        url: input.url,
        transport: input.transport ?? "streamable_http",
      };

      if (input.timeoutMs !== undefined) {
        config.timeoutMs = input.timeoutMs;
      }

      const hasHeaders = input.headers !== undefined && Object.keys(input.headers).length > 0;
      const encryptedSecrets = hasHeaders
        ? secretVault.encryptJson({ headers: input.headers })
        : null;

      const created = await sourcesRepo.insert({
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        kind: "mcp_remote",
        status: "active",
        config,
        encryptedSecrets,
        createdById: actor.id,
      });

      if (input.autoSync === false) {
        return {
          source: toPublicToolSource(created),
          syncedToolsCount: 0,
          syncError: null,
        };
      }

      try {
        const synced = await syncMcpSourceInternal(created);

        return {
          source: synced.source,
          syncedToolsCount: synced.syncedToolsCount,
          syncError: null,
        };
      } catch (error) {
        const refreshed = await sourcesRepo.findById(created.id);
        const message = error instanceof Error ? error.message : "Initial sync failed.";

        return {
          source: toPublicToolSource(refreshed ?? created),
          syncedToolsCount: 0,
          syncError: message,
        };
      }
    },

    registerLocalPlugin: async (
      actor: AuthenticatedUser,
      input: RegisterLocalPluginInput,
    ): Promise<RegisterPluginResult> => {
      let loaded: LoadedPlugin;

      try {
        loaded = await pluginRuntime.loadLocalPlugin(input.directoryName);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid local plugin.";

        throw new UnprocessableError(message);
      }

      const slug = input.slug ?? loaded.manifest.name;
      const existing = await sourcesRepo.findBySlug(slug);

      if (existing) {
        throw new ConflictError(`Tool source slug '${slug}' already exists.`);
      }

      const hasSecrets = input.secrets !== undefined && Object.keys(input.secrets).length > 0;
      const encryptedSecrets = hasSecrets ? secretVault.encryptJson({ env: input.secrets }) : null;

      const created = await sourcesRepo.insert({
        slug,
        name: input.name ?? loaded.manifest.name,
        description: input.description ?? loaded.manifest.description ?? null,
        kind: "plugin_code",
        status: "active",
        config: buildPluginConfig(loaded),
        encryptedSecrets,
        createdById: actor.id,
      });

      const syncedItems = buildPluginSyncedTools(slug, loaded);

      await toolsRepo.syncSourceTools(created.id, syncedItems);

      const updated = await sourcesRepo.update(created.id, {
        lastSyncedAt: new Date(),
        lastError: null,
      });

      return {
        source: toPublicToolSource(updated ?? created),
        syncedToolsCount: syncedItems.length,
      };
    },

    uploadPlugin: async (
      actor: AuthenticatedUser,
      input: UploadPluginInput,
    ): Promise<RegisterPluginResult> => {
      const requestedSlug =
        input.slug ?? (typeof input.manifest.name === "string" ? input.manifest.name : "");

      if (requestedSlug.length === 0) {
        throw new UnprocessableError("Plugin slug or manifest.name is required.");
      }

      const existing = await sourcesRepo.findBySlug(requestedSlug);

      if (existing) {
        throw new ConflictError(`Tool source slug '${requestedSlug}' already exists.`);
      }

      let loaded: LoadedPlugin;

      try {
        loaded = await pluginRuntime.installUploadedPlugin(
          requestedSlug,
          input.manifest,
          input.files,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid plugin bundle.";

        throw new UnprocessableError(message);
      }

      const hasSecrets = input.secrets !== undefined && Object.keys(input.secrets).length > 0;
      const encryptedSecrets = hasSecrets ? secretVault.encryptJson({ env: input.secrets }) : null;

      try {
        const created = await sourcesRepo.insert({
          slug: requestedSlug,
          name: input.name ?? loaded.manifest.name,
          description: input.description ?? loaded.manifest.description ?? null,
          kind: "plugin_code",
          status: "active",
          config: buildPluginConfig(loaded),
          encryptedSecrets,
          createdById: actor.id,
        });

        const syncedItems = buildPluginSyncedTools(requestedSlug, loaded);

        await toolsRepo.syncSourceTools(created.id, syncedItems);

        const updated = await sourcesRepo.update(created.id, {
          lastSyncedAt: new Date(),
          lastError: null,
        });

        return {
          source: toPublicToolSource(updated ?? created),
          syncedToolsCount: syncedItems.length,
        };
      } catch (error) {
        await pluginRuntime.removeUploadedPlugin(requestedSlug);
        throw error;
      }
    },

    update: async (id: string, input: UpdateSourceInput): Promise<PublicToolSource> => {
      const existing = await sourcesRepo.findById(id);

      if (!existing) {
        throw new NotFoundError("Tool source not found.");
      }

      const patch: UpdateSourceData = {};
      let upstreamChanged = false;

      if (input.name !== undefined) {
        patch.name = input.name;
      }

      if (input.description !== undefined) {
        patch.description = input.description;
      }

      if (input.status !== undefined) {
        patch.status = input.status;
      }

      if (
        input.url !== undefined ||
        input.transport !== undefined ||
        input.timeoutMs !== undefined
      ) {
        if (existing.config.kind !== "mcp_remote") {
          throw new UnprocessableError("MCP connection fields apply only to remote MCP sources.");
        }

        if (input.url !== undefined) {
          assertSafeUpstreamUrl(input.url);

          if (input.url !== existing.config.url) {
            upstreamChanged = true;
          }
        }

        const nextConfig: McpRemoteConfig = {
          kind: "mcp_remote",
          url: input.url ?? existing.config.url,
          transport: input.transport ?? existing.config.transport,
        };
        const nextTimeout = input.timeoutMs ?? existing.config.timeoutMs;

        if (nextTimeout !== undefined) {
          nextConfig.timeoutMs = nextTimeout;
        }

        patch.config = nextConfig;
      }

      if (input.headers !== undefined) {
        if (existing.config.kind !== "mcp_remote") {
          throw new UnprocessableError("HTTP headers apply only to remote MCP sources.");
        }

        upstreamChanged = true;

        if (input.headers === null || Object.keys(input.headers).length === 0) {
          patch.encryptedSecrets = null;
        } else {
          patch.encryptedSecrets = secretVault.encryptJson({ headers: input.headers });
        }
      }

      if (input.secrets !== undefined) {
        if (existing.config.kind !== "plugin_code") {
          throw new UnprocessableError("Plugin secrets apply only to code plugin sources.");
        }

        upstreamChanged = true;

        if (input.secrets === null || Object.keys(input.secrets).length === 0) {
          patch.encryptedSecrets = null;
        } else {
          patch.encryptedSecrets = secretVault.encryptJson({ env: input.secrets });
        }
      }

      const affectedEndpoints = await sourcesRepo.listAffectedEndpointIds(id);
      const updated = await sourcesRepo.update(id, patch);

      if (!updated) {
        throw new NotFoundError("Tool source not found.");
      }

      if (upstreamChanged) {
        const sourceTools = await toolsRepo.list(id);

        await invalidateTools(sourceTools.map((tool) => tool.id));
      }

      await invalidateEndpoints(affectedEndpoints);

      return toPublicToolSource(updated);
    },

    remove: async (id: string): Promise<void> => {
      const existing = await sourcesRepo.findById(id);

      if (!existing) {
        throw new NotFoundError("Tool source not found.");
      }

      const affectedEndpoints = await sourcesRepo.listAffectedEndpointIds(id);
      const sourceTools = await toolsRepo.list(id);
      const removed = await sourcesRepo.remove(id);

      if (!removed) {
        throw new NotFoundError("Tool source not found.");
      }

      if (existing.config.kind === "plugin_code" && existing.config.origin === "uploaded") {
        await pluginRuntime.removeUploadedPlugin(existing.config.directoryName);
      }

      await invalidateTools(sourceTools.map((tool) => tool.id));
      await invalidateEndpoints(affectedEndpoints);
    },

    syncSource: async (id: string): Promise<SyncSourceResult> => {
      const source = await sourcesRepo.findById(id);

      if (!source) {
        throw new NotFoundError("Tool source not found.");
      }

      if (source.kind === "plugin_code") {
        return syncLocalPluginInternal(source);
      }

      return syncMcpSourceInternal(source);
    },
  };
};
