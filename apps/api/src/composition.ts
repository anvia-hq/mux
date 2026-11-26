import { createBunRedisBackend } from "@mux/core/cache/redis-backend";
import { createToolCache } from "@mux/core/cache/tool-cache";
import { createSecretVault } from "@mux/core/crypto";
import { createDatabase } from "@mux/db";
import { createUpstreamMcpClient } from "@mux/mcp/upstream-client";
import { RedisClient } from "bun";
import { createAuth } from "./auth";
import { parseApiConfig } from "./config";
import { createDrizzleApiKeysRepository } from "./modules/api-keys/repository";
import { createApiKeysService } from "./modules/api-keys/service";
import { createDrizzleEndpointsRepository } from "./modules/endpoints/repository";
import { createEndpointsService } from "./modules/endpoints/service";
import { createDrizzleExecutionsRepository } from "./modules/executions/repository";
import { createMcpSourceExecutor, createToolExecutionService } from "./modules/executions/service";
import { createDrizzleSourcesRepository } from "./modules/sources/repository";
import { createSourcesService } from "./modules/sources/service";
import { createDrizzleToolsRepository } from "./modules/tools/repository";
import { createToolsService } from "./modules/tools/service";
import { createDrizzleUsersRepository } from "./modules/users/repository";
import { createUsersService } from "./modules/users/service";

export const createComposition = (env: Record<string, string | undefined> = process.env) => {
  const config = parseApiConfig(env);
  const corsOrigins = config.CORS_ORIGIN;
  const { client, db } = createDatabase(config.DATABASE_URL);
  const redisClient = new RedisClient(config.REDIS_URL);
  const toolCache = createToolCache(createBunRedisBackend(redisClient), {
    onCacheError: (error, key) => {
      console.error(`Cache error for key ${key}:`, error);
    },
  });
  const secretVault = createSecretVault(config.MUX_MASTER_KEY);
  const mcpClient = createUpstreamMcpClient();
  const auth = createAuth({
    db,
    secret: config.BETTER_AUTH_SECRET,
    baseUrl: config.BETTER_AUTH_URL,
    trustedOrigins: corsOrigins,
  });

  const usersRepo = createDrizzleUsersRepository(db);
  const endpointsRepo = createDrizzleEndpointsRepository(db);
  const apiKeysRepo = createDrizzleApiKeysRepository(db);
  const sourcesRepo = createDrizzleSourcesRepository(db);
  const toolsRepo = createDrizzleToolsRepository(db);
  const executionsRepo = createDrizzleExecutionsRepository(db);

  const usersService = createUsersService(usersRepo);
  const endpointsService = createEndpointsService({
    endpointsRepo,
    toolCache,
    onCacheError: (error, endpointId) => {
      console.error(`Failed to invalidate endpoint catalog ${endpointId}:`, error);
    },
  });
  const apiKeysService = createApiKeysService({
    apiKeysRepo,
    endpointsRepo,
    onBackgroundError: (error) => {
      console.error("Failed to update API key lastUsedAt:", error);
    },
  });
  const sourcesService = createSourcesService({
    sourcesRepo,
    toolsRepo,
    secretVault,
    mcpClient,
    toolCache,
    onCacheError: (error, key) => {
      console.error(`Failed to invalidate cache for ${key}:`, error);
    },
  });
  const toolsService = createToolsService({
    toolsRepo,
    toolCache,
    onCacheError: (error, key) => {
      console.error(`Failed to invalidate cache for ${key}:`, error);
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
    onAuditError: (error) => {
      console.error("Failed to record tool execution audit log:", error);
    },
  });

  const shutdown = async (): Promise<void> => {
    const errors: unknown[] = [];

    try {
      await toolCache.flushPendingRevalidations();
    } catch (error) {
      errors.push(error);
    }

    try {
      redisClient.close();
    } catch (error) {
      errors.push(error);
    }

    try {
      await client.end({ timeout: 5 });
    } catch (error) {
      errors.push(error);
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more shutdown steps failed.");
    }
  };

  return {
    config,
    corsOrigins,
    db,
    redisClient,
    toolCache,
    secretVault,
    mcpClient,
    authHandler: auth.handler,
    sessionResolver: auth.sessionResolver,
    usersService,
    endpointsService,
    apiKeysService,
    sourcesService,
    toolsService,
    toolsRepo,
    executionService,
    shutdown,
  };
};

export type ApiComposition = ReturnType<typeof createComposition>;
