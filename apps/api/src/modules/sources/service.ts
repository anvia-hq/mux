import { createDefaultCachePolicy } from "@mux/core/cache/schema";
import { computeSchemaHash } from "@mux/core/canonical-json";
import { buildToolSlug } from "@mux/core/manifest";
import type { McpRemoteConfig } from "@mux/core/types";
import { assertSafeUpstreamUrl } from "@mux/mcp/upstream-client";
import { z } from "zod";
import type { AuthenticatedUser } from "../../auth";
import { ConflictError, NotFoundError, UnavailableError, UnprocessableError } from "../../errors";
import type { UpsertSyncedToolInput } from "../tools/types";
import type {
  CreateMcpSourceInput,
  CreateMcpSourceResult,
  PublicToolSource,
  SourcesService,
  SourcesServiceDeps,
  SyncSourceResult,
  ToolSourceRecord,
  UpdateSourceData,
  UpdateSourceInput,
} from "./types";

const mcpSecretsSchema = z.object({
  headers: z.record(z.string(), z.string()),
});

const sanitizeToolSlugSegment = (rawName: string): string => {
  const normalized = rawName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "tool";
};

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
    for (const endpointId of endpointIds) {
      try {
        await toolCache.invalidateEndpointCatalog(endpointId);
      } catch (error) {
        reportCacheError(error, endpointId);
      }
    }
  };

  const syncMcpSourceInternal = async (source: ToolSourceRecord): Promise<SyncSourceResult> => {
    if (source.kind !== "mcp_remote" || source.config.kind !== "mcp_remote") {
      throw new UnprocessableError("Only remote MCP sources can be synced via MCP discovery.");
    }

    let headers: Record<string, string> | undefined;

    if (source.encryptedSecrets) {
      const decrypted = secretVault.decryptJson(source.encryptedSecrets, (val) =>
        mcpSecretsSchema.parse(val),
      );

      headers = decrypted.headers;
    }

    try {
      const discovered = await mcpClient.listTools({
        url: source.config.url,
        transport: source.config.transport,
        headers,
        timeoutMs: source.config.timeoutMs,
      });
      const usedSlugs = new Set<string>();
      const syncedItems: UpsertSyncedToolInput[] = [];

      for (const tool of discovered) {
        const baseSegment = sanitizeToolSlugSegment(tool.name);
        let slug = buildToolSlug(source.slug, baseSegment);
        let suffix = 2;

        while (usedSlugs.has(slug)) {
          slug = buildToolSlug(source.slug, `${baseSegment}_${suffix}`);
          suffix += 1;
        }

        usedSlugs.add(slug);
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

      const affectedEndpoints = await sourcesRepo.listAffectedEndpointIds(source.id);

      await toolsRepo.syncSourceTools(source.id, syncedItems);

      const updated = await sourcesRepo.update(source.id, {
        status: source.status === "disabled" ? "disabled" : "active",
        lastSyncedAt: new Date(),
        lastError: null,
      });

      await invalidateEndpoints(affectedEndpoints);

      return {
        source: toPublicToolSource(updated ?? source),
        syncedToolsCount: syncedItems.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync upstream MCP.";

      await sourcesRepo.update(source.id, {
        status: "error",
        lastError: message,
      });

      throw new UnavailableError(`Failed to sync MCP source '${source.slug}': ${message}`);
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

    update: async (id: string, input: UpdateSourceInput): Promise<PublicToolSource> => {
      const existing = await sourcesRepo.findById(id);

      if (!existing) {
        throw new NotFoundError("Tool source not found.");
      }

      const patch: UpdateSourceData = {};

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
        if (input.headers === null || Object.keys(input.headers).length === 0) {
          patch.encryptedSecrets = null;
        } else {
          patch.encryptedSecrets = secretVault.encryptJson({ headers: input.headers });
        }
      }

      const affectedEndpoints = await sourcesRepo.listAffectedEndpointIds(id);
      const updated = await sourcesRepo.update(id, patch);

      if (!updated) {
        throw new NotFoundError("Tool source not found.");
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

      for (const tool of sourceTools) {
        try {
          await toolCache.invalidateTool(tool.id);
        } catch (error) {
          reportCacheError(error, tool.id);
        }
      }

      await invalidateEndpoints(affectedEndpoints);
    },

    syncMcpSource: async (id: string): Promise<SyncSourceResult> => {
      const source = await sourcesRepo.findById(id);

      if (!source) {
        throw new NotFoundError("Tool source not found.");
      }

      return syncMcpSourceInternal(source);
    },
  };
};
