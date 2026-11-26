import { createBunRedisBackend } from "@mux/core/cache/redis-backend";
import { createToolCache } from "@mux/core/cache/tool-cache";
import { createSecretVault } from "@mux/core/crypto";
import { client, db } from "@mux/db";
import { RedisClient } from "bun";
import { createAuth } from "./auth";
import { parseApiConfig } from "./config";
import { createDrizzleApiKeysRepository } from "./modules/api-keys/repository";
import { createApiKeysService } from "./modules/api-keys/service";
import { createDrizzleEndpointsRepository } from "./modules/endpoints/repository";
import { createEndpointsService } from "./modules/endpoints/service";
import { createDrizzleUsersRepository } from "./modules/users/repository";
import { createUsersService } from "./modules/users/service";

const parseCorsOrigins = (raw: string): string[] => {
  const origins: string[] = [];

  for (const part of raw.split(",")) {
    const trimmed = part.trim();

    if (trimmed.length > 0) {
      origins.push(trimmed);
    }
  }

  return origins;
};

export const createComposition = (env: Record<string, string | undefined> = process.env) => {
  const config = parseApiConfig(env);
  const corsOrigins = parseCorsOrigins(config.CORS_ORIGIN);
  const redisClient = new RedisClient(config.REDIS_URL);
  const toolCache = createToolCache(createBunRedisBackend(redisClient));
  const secretVault = createSecretVault(config.MUX_MASTER_KEY);
  const auth = createAuth({
    db,
    secret: config.BETTER_AUTH_SECRET,
    baseUrl: config.BETTER_AUTH_URL,
    trustedOrigins: corsOrigins,
  });

  const usersRepo = createDrizzleUsersRepository(db);
  const endpointsRepo = createDrizzleEndpointsRepository(db);
  const apiKeysRepo = createDrizzleApiKeysRepository(db);

  const usersService = createUsersService(usersRepo);
  const endpointsService = createEndpointsService({ endpointsRepo, toolCache });
  const apiKeysService = createApiKeysService({ apiKeysRepo, endpointsRepo });

  const shutdown = async (): Promise<void> => {
    await toolCache.flushPendingRevalidations();
    redisClient.close();
    await client.end({ timeout: 5 });
  };

  return {
    config,
    corsOrigins,
    redisClient,
    toolCache,
    secretVault,
    authHandler: auth.handler,
    sessionResolver: auth.sessionResolver,
    usersService,
    endpointsService,
    apiKeysService,
    shutdown,
  };
};

export type ApiComposition = ReturnType<typeof createComposition>;
