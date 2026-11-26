import { randomUUID } from "node:crypto";
import type { ToolCachePolicy, UserRole } from "@mux/core/types";
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
import { createUsersService } from "../modules/users/service";
import type { UserRecord, UsersRepository } from "../modules/users/types";

export interface TestHarnessOptions {
  now?: () => number;
  knownToolIds?: string[];
  failCatalogInvalidation?: boolean;
}

export const createTestHarness = (options: TestHarnessOptions = {}) => {
  const now = options.now ?? Date.now;
  const usersStore = new Map<string, UserRecord>();
  const endpointsStore = new Map<string, EndpointRecord>();
  const endpointToolsStore = new Map<string, EndpointToolRecord>();
  const apiKeysStore = new Map<string, ApiKeyRecord>();
  const knownTools = new Set<string>(options.knownToolIds ?? []);
  const invalidatedEndpoints: string[] = [];

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
    findById: async (id) => usersStore.get(id) ?? null,
    countByRole: async (role) => {
      let total = 0;

      for (const user of usersStore.values()) {
        if (user.role === role) {
          total += 1;
        }
      }

      return total;
    },
    updateRole: async (id, role) => {
      const existing = usersStore.get(id);

      if (!existing) {
        return null;
      }

      const updated: UserRecord = { ...existing, role, updatedAt: new Date(now()) };

      usersStore.set(id, updated);

      return updated;
    },
  };

  const endpointsRepo: EndpointsRepository = {
    list: async () => [...endpointsStore.values()],
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
    toolExists: async (toolId) => knownTools.has(toolId),
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
      const existing = apiKeysStore.get(id);

      if (existing) {
        apiKeysStore.set(id, { ...existing, lastUsedAt: usedAt });
      }
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
    toolCache: {
      invalidateEndpointCatalog: async (endpointId: string) => {
        if (options.failCatalogInvalidation) {
          throw new Error("redis down");
        }

        invalidatedEndpoints.push(endpointId);

        return 1;
      },
    },
  });
  const apiKeysService = createApiKeysService({ apiKeysRepo, endpointsRepo, now });

  const app = createApp({
    corsOrigins: ["http://localhost:5173"],
    authHandler: async () => Response.json({ ok: true }),
    sessionResolver,
    usersService,
    apiKeysService,
    endpointsService,
  });

  const request = (
    path: string,
    init: { method?: string; userId?: string; body?: unknown } = {},
  ): Promise<Response> => {
    const headers = new Headers();

    if (init.userId) {
      headers.set("x-test-user", init.userId);
    }

    let body: string | undefined;

    if (init.body !== undefined) {
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
    endpointsService,
    usersService,
    invalidatedEndpoints,
  };
};
