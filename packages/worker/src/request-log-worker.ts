import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "./prisma";
import {
  REQUEST_LOG_QUEUE_NAME,
  type RequestLogJob,
  type RequestLogPayload,
} from "./request-log-queue";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const workerConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

workerConnection.on("error", (error) => {
  console.error("Request log worker Redis error:", error.message);
});

export function toRequestLogCreateInput(entry: RequestLogPayload) {
  return {
    id: entry.logId,
    apiKeyId: entry.apiKeyId,
    provider: entry.provider,
    model: entry.model,
    channelId: entry.channelId,
    channelName: entry.channelName,
    endpoint: entry.endpoint,
    latencyMs: entry.latencyMs,
    providerLatencyMs: entry.providerLatencyMs,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    totalTokens: entry.totalTokens,
    reasoningTokens: entry.reasoningTokens,
    estimatedCost: entry.estimatedCost,
    pricingInputTokens: entry.pricingInputTokens,
    appliedInputPricePer1M: entry.appliedInputPricePer1M,
    appliedOutputPricePer1M: entry.appliedOutputPricePer1M,
    appliedPricingTierThreshold: entry.appliedPricingTierThreshold,
    statusCode: entry.statusCode,
    errorMessage: entry.errorMessage ?? null,
  };
}

export function toRequestLogFinalizeInput(entry: RequestLogPayload) {
  return {
    provider: entry.provider,
    model: entry.model,
    channelId: entry.channelId ?? null,
    channelName: entry.channelName ?? null,
    endpoint: entry.endpoint,
    latencyMs: entry.latencyMs,
    providerLatencyMs: entry.providerLatencyMs ?? null,
    promptTokens: entry.promptTokens ?? null,
    completionTokens: entry.completionTokens ?? null,
    totalTokens: entry.totalTokens ?? null,
    reasoningTokens: entry.reasoningTokens ?? null,
    estimatedCost: entry.estimatedCost ?? null,
    pricingInputTokens: entry.pricingInputTokens ?? null,
    appliedInputPricePer1M: entry.appliedInputPricePer1M ?? null,
    appliedOutputPricePer1M: entry.appliedOutputPricePer1M ?? null,
    appliedPricingTierThreshold: entry.appliedPricingTierThreshold ?? null,
    statusCode: entry.statusCode,
    errorMessage: entry.errorMessage ?? null,
  };
}

async function createLogIfMissing(entry: RequestLogPayload): Promise<void> {
  await prisma.requestLog.createMany({
    data: [toRequestLogCreateInput(entry)],
    skipDuplicates: true,
  });
}

async function updateFinalizedLog(entry: RequestLogPayload) {
  return prisma.requestLog.updateMany({
    where: { id: entry.logId },
    data: toRequestLogFinalizeInput(entry),
  });
}

async function finalizeStreamLog(entry: RequestLogPayload): Promise<void> {
  const update = await updateFinalizedLog(entry);

  if (update.count === 0) {
    await createLogIfMissing(entry);
    await updateFinalizedLog(entry);
  }
}

export async function processRequestLogJob(job: RequestLogJob): Promise<void> {
  if (job.kind === "stream-finalize") {
    await finalizeStreamLog(job);
    return;
  }

  await createLogIfMissing(job);
}

export async function initializeSpendLedgerFromRequestLogs(): Promise<void> {
  const rows = await prisma.requestLog.groupBy({
    by: ["apiKeyId"],
    where: {
      statusCode: { gte: 200, lt: 300 },
      estimatedCost: { not: null },
    },
    _sum: { estimatedCost: true },
  });

  for (const row of rows) {
    await workerConnection.set(
      `apikey_spend:${row.apiKeyId}`,
      String(row._sum.estimatedCost ?? 0),
      "NX",
    );
  }

  if (rows.length === 0) {
    return;
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: { id: { in: rows.map((row) => row.apiKeyId) } },
    select: { id: true, createdBy: true },
  });
  const ownerByKeyId = new Map(apiKeys.map((apiKey) => [apiKey.id, apiKey.createdBy]));
  const spendByUserId = new Map<string, number>();

  for (const row of rows) {
    const userId = ownerByKeyId.get(row.apiKeyId);
    if (!userId) {
      continue;
    }

    spendByUserId.set(userId, (spendByUserId.get(userId) ?? 0) + (row._sum.estimatedCost ?? 0));
  }

  for (const [userId, spentUsd] of spendByUserId) {
    await workerConnection.set(`user_spend:${userId}`, String(spentUsd), "NX");
  }
}

export async function startRequestLogWorker(): Promise<Worker<RequestLogJob>> {
  await initializeSpendLedgerFromRequestLogs();

  return new Worker<RequestLogJob>(
    REQUEST_LOG_QUEUE_NAME,
    async (job) => {
      await processRequestLogJob(job.data);
    },
    {
      connection: workerConnection,
      concurrency: Number(process.env.REQUEST_LOG_WORKER_CONCURRENCY ?? 10),
    },
  );
}
