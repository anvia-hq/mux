import { type Context, Hono } from "hono";
import { z } from "zod";
import { reloadProvider, clearProviderCacheForE2e } from "../../providers/registry";
import { prisma } from "../../utils/prisma";
import { redis } from "../../utils/redis";
import { createAdminUser, createUserAccount } from "../auth/services";
import { sanitizeUser } from "../auth/utils";
import { createApiKey, revokeApiKey } from "../keys/services";
import { encrypt, lastFour } from "../providers/crypto";

const tables = [
  "RequestLog",
  "BackgroundResponseJob",
  "FallbackTarget",
  "FallbackGroup",
  "DisabledModel",
  "ProviderKey",
  "ApiKey",
  "User",
];

const userSeedSchema = z.object({
  email: z.string().email(),
  name: z.string().nullable().optional(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "USER"]).default("USER"),
});

const apiKeySeedSchema = z.object({
  name: z.string().min(1),
  createdByEmail: z.string().email().optional(),
  spendLimitUsd: z.number().positive().nullable().optional(),
  isActive: z.boolean().default(true),
});

const requestLogSeedSchema = z.object({
  apiKeyName: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  endpoint: z.string().min(1).default("/v1/chat/completions"),
  latencyMs: z.number().int().nonnegative().default(120),
  providerLatencyMs: z.number().int().nonnegative().nullable().optional(),
  promptTokens: z.number().int().nonnegative().nullable().optional(),
  completionTokens: z.number().int().nonnegative().nullable().optional(),
  totalTokens: z.number().int().nonnegative().nullable().optional(),
  estimatedCost: z.number().nonnegative().nullable().optional(),
  statusCode: z.number().int().min(100).max(599).default(200),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string().datetime().optional(),
});

const fallbackGroupSeedSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
  targets: z
    .array(
      z.object({
        provider: z.string().min(1),
        modelId: z.string().min(1),
      }),
    )
    .min(1),
});

const seedSchema = z.object({
  users: z.array(userSeedSchema).optional(),
  syntheticProvider: z.boolean().optional(),
  e2eProvider: z.boolean().optional(),
  apiKeys: z.array(apiKeySeedSchema).optional(),
  requestLogs: z.array(requestLogSeedSchema).optional(),
  fallbackGroups: z.array(fallbackGroupSeedSchema).optional(),
});

function authorizeE2e(c: Context) {
  const expectedToken = process.env.E2E_RESET_TOKEN;
  if (!expectedToken) {
    return c.json({ error: "not found" }, 404);
  }

  if (c.req.header("x-e2e-reset-token") !== expectedToken) {
    return c.json({ error: "forbidden" }, 403);
  }

  return null;
}

async function resetState() {
  const tableList = tables.map((table) => `"${table}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
  clearProviderCacheForE2e();
  await redis.flushdb();
}

async function findSeedUser(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`seed user not found: ${email}`);
  }
  return user;
}

async function findSeedAdmin() {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) {
    throw new Error("seed requires at least one admin user");
  }
  return admin;
}

export const e2eRouter = new Hono()
  .post("/reset", async (c) => {
    const unauthorized = authorizeE2e(c);
    if (unauthorized) return unauthorized;

    await resetState();

    return c.json({ ok: true });
  })
  .post("/seed", async (c) => {
    const unauthorized = authorizeE2e(c);
    if (unauthorized) return unauthorized;

    const parsed = seedSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "invalid seed data", issues: parsed.error.issues }, 400);
    }

    const seed = parsed.data;
    const users = [];
    for (const input of seed.users ?? []) {
      const user =
        input.role === "ADMIN"
          ? await createAdminUser({
              email: input.email,
              name: input.name ?? null,
              password: input.password,
            })
          : await createUserAccount({
              email: input.email,
              name: input.name ?? null,
              password: input.password,
            });
      users.push(sanitizeUser(user));
    }

    const providerKeys = [];
    if (seed.syntheticProvider) {
      const updater = await findSeedAdmin();
      const apiKey = "synthetic-e2e-provider-key";
      const row = await prisma.providerKey.upsert({
        where: { provider: "synthetic" },
        create: {
          provider: "synthetic",
          ciphertext: encrypt(apiKey),
          lastFour: lastFour(apiKey),
          updatedBy: updater.id,
        },
        update: {
          ciphertext: encrypt(apiKey),
          lastFour: lastFour(apiKey),
          updatedBy: updater.id,
        },
      });
      await reloadProvider("synthetic");
      providerKeys.push({ provider: row.provider, lastFour: row.lastFour });
    }

    if (seed.e2eProvider) {
      const updater = await findSeedAdmin();
      const apiKey = "e2e-provider-key";
      const row = await prisma.providerKey.upsert({
        where: { provider: "e2e" },
        create: {
          provider: "e2e",
          ciphertext: encrypt(apiKey),
          lastFour: lastFour(apiKey),
          updatedBy: updater.id,
        },
        update: {
          ciphertext: encrypt(apiKey),
          lastFour: lastFour(apiKey),
          updatedBy: updater.id,
        },
      });
      await reloadProvider("e2e");
      providerKeys.push({ provider: row.provider, lastFour: row.lastFour });
    }

    const apiKeys = [];
    const apiKeyIdsByName = new Map<string, string>();
    for (const input of seed.apiKeys ?? []) {
      const creator = input.createdByEmail
        ? await findSeedUser(input.createdByEmail)
        : await findSeedAdmin();
      const created = await createApiKey(input.name, creator.id, input.spendLimitUsd);
      if (!input.isActive) {
        await revokeApiKey(created.id);
      }
      apiKeyIdsByName.set(input.name, created.id);
      apiKeys.push({
        id: created.id,
        name: input.name,
        rawKey: created.key,
        isActive: input.isActive,
      });
    }

    const requestLogs = [];
    for (const input of seed.requestLogs ?? []) {
      const apiKeyId = apiKeyIdsByName.get(input.apiKeyName);
      if (!apiKeyId) {
        return c.json({ error: `seed API key not found for log: ${input.apiKeyName}` }, 400);
      }
      const row = await prisma.requestLog.create({
        data: {
          apiKeyId,
          provider: input.provider,
          model: input.model,
          endpoint: input.endpoint,
          latencyMs: input.latencyMs,
          providerLatencyMs: input.providerLatencyMs ?? null,
          promptTokens: input.promptTokens ?? null,
          completionTokens: input.completionTokens ?? null,
          totalTokens: input.totalTokens ?? null,
          estimatedCost: input.estimatedCost ?? null,
          statusCode: input.statusCode,
          errorMessage: input.errorMessage ?? null,
          createdAt: input.createdAt ? new Date(input.createdAt) : undefined,
        },
      });
      requestLogs.push({ id: row.id, provider: row.provider, model: row.model });
    }

    const fallbackGroups = [];
    for (const input of seed.fallbackGroups ?? []) {
      const group = await prisma.fallbackGroup.create({
        data: {
          id: input.id,
          name: input.name,
          description: input.description ?? null,
          enabled: input.enabled,
          targets: {
            create: input.targets.map((target, index) => ({
              provider: target.provider,
              modelId: target.modelId,
              position: index + 1,
            })),
          },
        },
      });
      fallbackGroups.push({ id: group.id, name: group.name, enabled: group.enabled });
    }

    return c.json({ users, apiKeys, providerKeys, requestLogs, fallbackGroups });
  })
  .get("/request-logs", async (c) => {
    const unauthorized = authorizeE2e(c);
    if (unauthorized) return unauthorized;

    const rows = await prisma.requestLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        apiKey: { select: { name: true } },
      },
    });

    return c.json({
      requestLogs: rows.map((row) => ({
        id: row.id,
        apiKeyName: row.apiKey.name,
        provider: row.provider,
        model: row.model,
        endpoint: row.endpoint,
        latencyMs: row.latencyMs,
        providerLatencyMs: row.providerLatencyMs,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        totalTokens: row.totalTokens,
        reasoningTokens: row.reasoningTokens,
        estimatedCost: row.estimatedCost,
        statusCode: row.statusCode,
        errorMessage: row.errorMessage,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  });
