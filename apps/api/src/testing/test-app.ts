import { randomUUID } from "node:crypto";
import { createToolCache } from "@mux/core/cache/tool-cache";
import { createSecretVault } from "@mux/core/crypto";
import { createMemoryRedisBackend } from "./memory-redis-backend";
import type {
  CanonicalTool,
  ToolCachePolicy,
  ToolExecutionResult,
  UserRole,
} from "@mux/core/types";
import type { DiscoveredMcpTool, UpstreamMcpClient, UpstreamMcpTarget } from "@mux/mcp/types";
import { createApp } from "../app";
import type { AuthenticatedUser, SessionResolver } from "../auth";
import { createApiKeysService } from "../modules/api-keys/service";
import type { ApiKeyRecord, ApiKeysRepository, InsertApiKeyData } from "../modules/api-keys/types";
import { createEndpointsService } from "../modules/endpoints/service";
import type {
  EndpointRecord,
  EndpointToolRecord,
  EndpointsRepository,
  InsertEndpointData,
  UpdateEndpointInput,
} from "../modules/endpoints/types";
import { createMcpSourceExecutor, createToolExecutionService } from "../modules/executions/service";
import type {
  ExecutionsRepository,
  InsertExecutionData,
  ListExecutionsFilter,
  ToolExecutionRecord,
} from "../modules/executions/types";
import { createSourcesService } from "../modules/sources/service";
import type {
  InsertSourceData,
  SourcesRepository,
  ToolSourceRecord,
  UpdateSourceData,
} from "../modules/sources/types";
import { createToolsService } from "../modules/tools/service";
import type {
  ToolRecord,
  ToolsRepository,
  UpdateToolInput,
  UpsertSyncedToolInput,
} from "../modules/tools/types";
import { createUsersService } from "../modules/users/service";
import type { UpdateUserRoleOutcome, UserRecord, UsersRepository } from "../modules/users/types";

export interface TestHarnessOptions {
  now?: () => number;
  knownToolIds?: string[];
  failCatalogInvalidation?: boolean;
  failTouchLastUsed?: boolean;
  failEndpointsList?: boolean;
  upstreamMcp?: {
    listTools?: (target: UpstreamMcpTarget) => Promise<DiscoveredMcpTool[]>;
    callTool?: (
      target: UpstreamMcpTarget,
      toolName: string,
      args: Record<string, unknown>,
    ) => Promise<ToolExecutionResult>;
  };
}

export const createTestHarness = (options: TestHarnessOptions = {}) => {
  const now = options.now ?? Date.now;
  const usersStore = new Map<string, UserRecord>();
  const endpointsStore = new Map<string, EndpointRecord>();
  const endpointToolsStore = new Map<string, EndpointToolRecord>();
  const apiKeysStore = new Map<string, ApiKeyRecord>();
  const sourcesStore = new Map<string, ToolSourceRecord>();
  const toolsStore = new Map<string, ToolRecord>();
  const executionsStore: ToolExecutionRecord[] = [];
  const knownTools = new Set<string>(options.knownToolIds ?? []);
  const invalidatedEndpoints: string[] = [];
  const authPathsCalled: string[] = [];
  const backgroundErrors: unknown[] = [];
  const unexpectedErrors: unknown[] = [];
  let touchLastUsedCalls = 0;

  const secretVault = createSecretVault("mux-test-master-key-with-more-than-32-characters");
  const memoryRedis = createMemoryRedisBackend(now);
  const rawToolCache = createToolCache(memoryRedis, {
    now,
    onCacheError: (error) => {
      backgroundErrors.push(error);
    },
  });

  const toolCache = {
    ...rawToolCache,
    invalidateEndpointCatalog: async (endpointId: string) => {
      if (options.failCatalogInvalidation) {
        throw new Error("redis down");
      }

      invalidatedEndpoints.push(endpointId);

      return rawToolCache.invalidateEndpointCatalog(endpointId);
    },
  };

  const mcpClient: UpstreamMcpClient = {
    listTools: async (target) => {
      if (options.upstreamMcp?.listTools) {
        return options.upstreamMcp.listTools(target);
      }

      return [];
    },
    callTool: async (target, toolName, args) => {
      if (options.upstreamMcp?.callTool) {
        return options.upstreamMcp.callTool(target, toolName, args);
      }

      return { content: [{ type: "text", text: JSON.stringify({ toolName, args }) }] };
    },
  };

  const seedUser = (input: { id: string; email: string; name: string; role: UserRole }) => {
    const timestamp = new Date(now());
    const record: UserRecord = {
      id: input.id,
      email: input.email,
      name: input.name,
      emailVerified: true,
      image: null,
      role: input.role,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    usersStore.set(record.id, record);

    return record;
  };

  const usersRepo: UsersRepository = {
    list: async () => [...usersStore.values()],
    updateRoleAtomic: async (id, role): Promise<UpdateUserRoleOutcome> => {
      const existing = usersStore.get(id);

      if (!existing) {
        return { status: "not_found" };
      }

      if (existing.role === role) {
        return { status: "updated", user: existing };
      }

      if (existing.role === "admin" && role === "member") {
        let adminCount = 0;

        for (const user of usersStore.values()) {
          if (user.role === "admin") {
            adminCount += 1;
          }
        }

        if (adminCount <= 1) {
          return { status: "last_admin" };
        }
      }

      const updated: UserRecord = { ...existing, role, updatedAt: new Date(now()) };

      usersStore.set(id, updated);

      return { status: "updated", user: updated };
    },
  };

  const endpointsRepo: EndpointsRepository = {
    list: async () => {
      if (options.failEndpointsList) {
        throw new Error("secret-database-credentials-must-not-leak");
      }

      return [...endpointsStore.values()];
    },
    findById: async (id) => endpointsStore.get(id) ?? null,
    findBySlug: async (slug) => {
      for (const endpoint of endpointsStore.values()) {
        if (endpoint.slug === slug) {
          return endpoint;
        }
      }

      return null;
    },
    insert: async (data: InsertEndpointData) => {
      const timestamp = new Date(now());
      const record: EndpointRecord = {
        id: randomUUID(),
        slug: data.slug,
        name: data.name,
        description: data.description,
        mode: data.mode,
        enabled: data.enabled,
        createdById: data.createdById,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      endpointsStore.set(record.id, record);

      return record;
    },
    update: async (id: string, input: UpdateEndpointInput) => {
      const existing = endpointsStore.get(id);

      if (!existing) {
        return null;
      }

      const updated: EndpointRecord = {
        ...existing,
        name: input.name ?? existing.name,
        description: input.description !== undefined ? input.description : existing.description,
        mode: input.mode ?? existing.mode,
        enabled: input.enabled ?? existing.enabled,
        updatedAt: new Date(now()),
      };

      endpointsStore.set(id, updated);

      return updated;
    },
    remove: async (id) => {
      const removed = endpointsStore.delete(id);

      if (removed) {
        for (const [key, binding] of endpointToolsStore.entries()) {
          if (binding.endpointId === id) {
            endpointToolsStore.delete(key);
          }
        }
      }

      return removed;
    },
    listTools: async (endpointId) => {
      const matches: EndpointToolRecord[] = [];

      for (const binding of endpointToolsStore.values()) {
        if (binding.endpointId === endpointId) {
          matches.push(binding);
        }
      }

      return matches;
    },
    toolExists: async (toolId) => knownTools.has(toolId) || toolsStore.has(toolId),
    upsertTool: async (
      endpointId: string,
      toolId: string,
      input: { enabled: boolean; cachePolicyOverride: ToolCachePolicy | null },
    ) => {
      const key = `${endpointId}:${toolId}`;
      const existing = endpointToolsStore.get(key);
      const timestamp = new Date(now());

      if (existing) {
        const updated: EndpointToolRecord = {
          ...existing,
          enabled: input.enabled,
          cachePolicyOverride: input.cachePolicyOverride,
          updatedAt: timestamp,
        };

        endpointToolsStore.set(key, updated);

        return updated;
      }

      const created: EndpointToolRecord = {
        id: randomUUID(),
        endpointId,
        toolId,
        enabled: input.enabled,
        cachePolicyOverride: input.cachePolicyOverride,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      endpointToolsStore.set(key, created);

      return created;
    },
    removeTool: async (endpointId, toolId) => endpointToolsStore.delete(`${endpointId}:${toolId}`),
  };

  const apiKeysRepo: ApiKeysRepository = {
    listAll: async () => [...apiKeysStore.values()],
    listByCreator: async (userId) => {
      const matches: ApiKeyRecord[] = [];

      for (const key of apiKeysStore.values()) {
        if (key.createdById === userId) {
          matches.push(key);
        }
      }

      return matches;
    },
    findById: async (id) => apiKeysStore.get(id) ?? null,
    findByHash: async (keyHash) => {
      for (const key of apiKeysStore.values()) {
        if (key.keyHash === keyHash) {
          return key;
        }
      }

      return null;
    },
    insert: async (data: InsertApiKeyData) => {
      const timestamp = new Date(now());
      const record: ApiKeyRecord = {
        id: randomUUID(),
        name: data.name,
        keyPrefix: data.keyPrefix,
        keyHash: data.keyHash,
        endpointId: data.endpointId,
        createdById: data.createdById,
        lastUsedAt: null,
        expiresAt: data.expiresAt,
        revokedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      apiKeysStore.set(record.id, record);

      return record;
    },
    revoke: async (id, revokedAt) => {
      const existing = apiKeysStore.get(id);

      if (!existing) {
        return null;
      }

      const updated: ApiKeyRecord = { ...existing, revokedAt, updatedAt: revokedAt };

      apiKeysStore.set(id, updated);

      return updated;
    },
    touchLastUsed: async (id, usedAt) => {
      touchLastUsedCalls += 1;

      if (options.failTouchLastUsed) {
        throw new Error("touchLastUsed db failure");
      }

      const existing = apiKeysStore.get(id);

      if (existing) {
        apiKeysStore.set(id, { ...existing, lastUsedAt: usedAt });
      }
    },
  };

  const sourcesRepo: SourcesRepository = {
    list: async () => [...sourcesStore.values()],
    findById: async (id) => sourcesStore.get(id) ?? null,
    findBySlug: async (slug) => {
      for (const source of sourcesStore.values()) {
        if (source.slug === slug) {
          return source;
        }
      }

      return null;
    },
    insert: async (data: InsertSourceData) => {
      const timestamp = new Date(now());
      const record: ToolSourceRecord = {
        id: randomUUID(),
        slug: data.slug,
        name: data.name,
        description: data.description,
        kind: data.kind,
        status: data.status,
        config: data.config,
        encryptedSecrets: data.encryptedSecrets,
        lastSyncedAt: null,
        lastError: null,
        createdById: data.createdById,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      sourcesStore.set(record.id, record);

      return record;
    },
    update: async (id: string, data: UpdateSourceData) => {
      const existing = sourcesStore.get(id);

      if (!existing) {
        return null;
      }

      const updated: ToolSourceRecord = {
        ...existing,
        name: data.name ?? existing.name,
        description: data.description !== undefined ? data.description : existing.description,
        status: data.status ?? existing.status,
        config: data.config ?? existing.config,
        encryptedSecrets:
          data.encryptedSecrets !== undefined ? data.encryptedSecrets : existing.encryptedSecrets,
        lastSyncedAt: data.lastSyncedAt !== undefined ? data.lastSyncedAt : existing.lastSyncedAt,
        lastError: data.lastError !== undefined ? data.lastError : existing.lastError,
        updatedAt: new Date(now()),
      };

      sourcesStore.set(id, updated);

      return updated;
    },
    remove: async (id) => {
      const removed = sourcesStore.delete(id);

      if (removed) {
        const deletedToolIds = new Set<string>();

        for (const [toolId, tool] of toolsStore.entries()) {
          if (tool.sourceId === id) {
            toolsStore.delete(toolId);
            deletedToolIds.add(toolId);
          }
        }

        for (const [key, binding] of endpointToolsStore.entries()) {
          if (deletedToolIds.has(binding.toolId)) {
            endpointToolsStore.delete(key);
          }
        }
      }

      return removed;
    },
    listAffectedEndpointIds: async (sourceId) => {
      const endpointIds = new Set<string>();

      for (const binding of endpointToolsStore.values()) {
        const tool = toolsStore.get(binding.toolId);

        if (tool && tool.sourceId === sourceId) {
          endpointIds.add(binding.endpointId);
        }
      }

      return [...endpointIds];
    },
  };

  const toolsRepo: ToolsRepository = {
    list: async (sourceId) => {
      const items: ToolRecord[] = [];

      for (const tool of toolsStore.values()) {
        if (!sourceId || tool.sourceId === sourceId) {
          items.push(tool);
        }
      }

      return items.sort((a, b) => a.slug.localeCompare(b.slug));
    },
    findById: async (id) => toolsStore.get(id) ?? null,
    findBySlug: async (slug) => {
      for (const tool of toolsStore.values()) {
        if (tool.slug === slug) {
          return tool;
        }
      }

      return null;
    },
    syncSourceTools: async (sourceId: string, items: UpsertSyncedToolInput[]) => {
      const incomingNames = new Set(items.map((item) => item.name));

      for (const [toolId, existing] of toolsStore.entries()) {
        if (existing.sourceId === sourceId && !incomingNames.has(existing.name)) {
          toolsStore.delete(toolId);
        }
      }

      const timestamp = new Date(now());
      const synced: ToolRecord[] = [];

      for (const item of items) {
        let matched: ToolRecord | undefined;

        for (const existing of toolsStore.values()) {
          if (existing.sourceId === sourceId && existing.name === item.name) {
            matched = existing;
            break;
          }
        }

        if (matched) {
          const updated: ToolRecord = {
            ...matched,
            slug: item.slug,
            description: item.description,
            inputSchema: item.inputSchema,
            annotations: item.annotations,
            schemaHash: item.schemaHash,
            updatedAt: timestamp,
          };

          toolsStore.set(matched.id, updated);
          synced.push(updated);
        } else {
          const created: ToolRecord = {
            id: randomUUID(),
            sourceId,
            name: item.name,
            slug: item.slug,
            description: item.description,
            inputSchema: item.inputSchema,
            annotations: item.annotations,
            cachePolicy: item.defaultCachePolicy,
            schemaHash: item.schemaHash,
            enabled: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          };

          toolsStore.set(created.id, created);
          synced.push(created);
        }
      }

      return synced;
    },
    update: async (id: string, input: UpdateToolInput) => {
      const existing = toolsStore.get(id);

      if (!existing) {
        return null;
      }

      const updated: ToolRecord = {
        ...existing,
        enabled: input.enabled ?? existing.enabled,
        cachePolicy: input.cachePolicy ?? existing.cachePolicy,
        updatedAt: new Date(now()),
      };

      toolsStore.set(id, updated);

      return updated;
    },
    listEndpointIdsForTool: async (toolId) => {
      const ids = new Set<string>();

      for (const binding of endpointToolsStore.values()) {
        if (binding.toolId === toolId) {
          ids.add(binding.endpointId);
        }
      }

      return [...ids];
    },
    listCanonicalToolsForEndpoint: async (endpointId) => {
      const result: CanonicalTool[] = [];

      for (const binding of endpointToolsStore.values()) {
        if (binding.endpointId !== endpointId || !binding.enabled) {
          continue;
        }

        const tool = toolsStore.get(binding.toolId);

        if (!tool || !tool.enabled) {
          continue;
        }

        const source = sourcesStore.get(tool.sourceId);

        if (!source || source.status !== "active") {
          continue;
        }

        result.push({
          id: tool.id,
          sourceId: tool.sourceId,
          sourceSlug: source.slug,
          sourceKind: source.kind,
          name: tool.name,
          slug: tool.slug,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          cachePolicy: binding.cachePolicyOverride ?? tool.cachePolicy,
          schemaHash: tool.schemaHash,
          enabled: tool.enabled,
        });
      }

      return result.sort((a, b) => a.slug.localeCompare(b.slug));
    },
  };

  const executionsRepo: ExecutionsRepository = {
    insert: async (data: InsertExecutionData) => {
      const record: ToolExecutionRecord = {
        id: randomUUID(),
        ...data,
        createdAt: new Date(now()),
      };

      executionsStore.unshift(record);

      return record;
    },
    list: async (filter: ListExecutionsFilter) => {
      const filtered: ToolExecutionRecord[] = [];

      for (const record of executionsStore) {
        if (filter.toolId && record.toolId !== filter.toolId) {
          continue;
        }

        if (filter.endpointId && record.endpointId !== filter.endpointId) {
          continue;
        }

        filtered.push(record);

        if (filtered.length >= filter.limit) {
          break;
        }
      }

      return filtered;
    },
  };

  const sessionResolver: SessionResolver = {
    getSessionUser: async (headers: Headers): Promise<AuthenticatedUser | null> => {
      const userId = headers.get("x-test-user");

      if (!userId) {
        return null;
      }

      const record = usersStore.get(userId);

      if (!record) {
        return null;
      }

      return {
        id: record.id,
        email: record.email,
        name: record.name,
        role: record.role,
      };
    },
  };

  const usersService = createUsersService(usersRepo);
  const endpointsService = createEndpointsService({
    endpointsRepo,
    toolCache,
    onCacheError: (error) => {
      backgroundErrors.push(error);
    },
  });
  const apiKeysService = createApiKeysService({
    apiKeysRepo,
    endpointsRepo,
    now,
    onBackgroundError: (error) => {
      backgroundErrors.push(error);
    },
  });
  const sourcesService = createSourcesService({
    sourcesRepo,
    toolsRepo,
    secretVault,
    mcpClient,
    toolCache,
    onCacheError: (error) => {
      backgroundErrors.push(error);
    },
  });
  const toolsService = createToolsService({
    toolsRepo,
    toolCache,
    onCacheError: (error) => {
      backgroundErrors.push(error);
    },
  });
  const executionService = createToolExecutionService({
    executionsRepo,
    sourcesRepo,
    toolsRepo,
    toolCache,
    executors: {
      mcp_remote: createMcpSourceExecutor({ mcpClient, secretVault }),
    },
    now,
    onAuditError: (error) => {
      backgroundErrors.push(error);
    },
  });

  const app = createApp({
    corsOrigins: ["http://localhost:5173"],
    authHandler: async (req) => {
      authPathsCalled.push(new URL(req.url).pathname);

      return Response.json({ ok: true });
    },
    sessionResolver,
    usersService,
    apiKeysService,
    endpointsService,
    sourcesService,
    toolsService,
    toolsRepo,
    toolCache,
    executionService,
    onUnexpectedError: (error) => {
      unexpectedErrors.push(error);
    },
  });

  const request = (
    path: string,
    init: {
      method?: string;
      userId?: string;
      bearerToken?: string;
      body?: unknown;
      rawBody?: string;
    } = {},
  ): Promise<Response> => {
    const headers = new Headers();

    if (init.userId) {
      headers.set("x-test-user", init.userId);
    }

    if (init.bearerToken) {
      headers.set("authorization", `Bearer ${init.bearerToken}`);
    }

    let body: string | undefined;

    if (init.rawBody !== undefined) {
      headers.set("content-type", "application/json");
      body = init.rawBody;
    } else if (init.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.body);
    }

    return app.handle(
      new Request(`http://localhost${path}`, {
        method: init.method ?? "GET",
        headers,
        body,
      }),
    );
  };

  return {
    app,
    request,
    seedUser,
    apiKeysService,
    apiKeysRepo,
    endpointsService,
    sourcesService,
    toolsService,
    executionService,
    usersService,
    invalidatedEndpoints,
    authPathsCalled,
    backgroundErrors,
    unexpectedErrors,
    getTouchLastUsedCalls: () => touchLastUsedCalls,
  };
};
