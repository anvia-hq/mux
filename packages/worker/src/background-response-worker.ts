import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "./prisma";
import {
  BACKGROUND_POLL_QUEUE_NAME,
  backgroundPollConnection,
  enqueueBackgroundPoll,
  type BackgroundPollJob,
} from "./background-response-queue";
import {
  enqueueRequestLog,
  REQUEST_LOG_QUEUE_NAME,
  type RequestLogJob,
} from "./request-log-queue";

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "failed"]);
const MAX_BACKOFF_MS = 30_000;
const POLL_INTERVAL_BASE_MS = 2_000;

export function backoffMs(attempt: number): number {
  // attempt is 1-indexed. 1 -> 2s, 2 -> 4s, 3 -> 8s, 4 -> 16s, 5+ -> 30s cap.
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const candidate = POLL_INTERVAL_BASE_MS * 2 ** (safeAttempt - 1);
  return Math.min(candidate, MAX_BACKOFF_MS);
}

type UpstreamResponsesApiErrorLike = Error & { status?: number };

type ProcessDeps = {
  fetch: typeof fetch;
  redis: IORedis;
  now: () => Date;
  enqueue: (jobId: string, attempt: number, delayMs: number) => Promise<void>;
  enqueueLog: (job: RequestLogJob) => Promise<void>;
  prismaClient: typeof prisma;
};

const defaultDeps: ProcessDeps = {
  fetch: (...args) => fetch(...args),
  redis: backgroundPollConnection,
  now: () => new Date(),
  enqueue: enqueueBackgroundPoll,
  enqueueLog: enqueueRequestLog,
  prismaClient: prisma,
};

type BackgroundJobRecord = {
  id: string;
  apiKeyId: string;
  provider: string;
  model: string;
  status: string;
  response: unknown;
};

type UpstreamResponse = {
  id?: string;
  status?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export async function processBackgroundPollJob(
  job: BackgroundPollJob,
  deps: Partial<ProcessDeps> = {},
): Promise<void> {
  const { fetch: fetchFn, redis, now, enqueue, enqueueLog, prismaClient } = {
    ...defaultDeps,
    ...deps,
  };

  const row = (await prismaClient.backgroundResponseJob.findUnique({
    where: { id: job.jobId },
  })) as BackgroundJobRecord | null;

  if (!row) {
    return;
  }

  if (TERMINAL_STATUSES.has(row.status)) {
    return;
  }

  let upstreamResponse: UpstreamResponse;
  try {
    upstreamResponse = await fetchUpstream(row, fetchFn);
  } catch (error) {
    const apiError = error as UpstreamResponsesApiErrorLike;
    if (typeof apiError.status === "number" && apiError.status === 404) {
      await prismaClient.backgroundResponseJob.update({
        where: { id: row.id },
        data: {
          status: "failed",
          errorMessage: "upstream 404 while polling",
          completedAt: now(),
        },
      });
      return;
    }
    throw error;
  }

  const upstreamStatus =
    typeof upstreamResponse.status === "string" ? upstreamResponse.status : "queued";

  if (TERMINAL_STATUSES.has(upstreamStatus)) {
    const updateData: Record<string, unknown> = {
      status: upstreamStatus,
      response: upstreamResponse as object,
      completedAt: now(),
    };
    if (upstreamStatus === "failed") {
      updateData.errorMessage =
        typeof upstreamResponse.error === "object" && upstreamResponse.error !== null
          ? JSON.stringify(upstreamResponse.error)
          : "upstream reported failed";
    }
    await prismaClient.backgroundResponseJob.update({
      where: { id: row.id },
      data: updateData,
    });

    if (upstreamStatus === "completed") {
      const usage = upstreamResponse.usage;
      if (usage?.input_tokens || usage?.output_tokens) {
        const cost = computeCost(usage.input_tokens, usage.output_tokens, row.model);
        if (cost !== undefined && Number.isFinite(cost) && cost > 0) {
          try {
            await redis.incrbyfloat(`apikey_spend:${row.apiKeyId}`, cost);
          } catch (error) {
            console.error(
              `Failed to bill background response ${row.id}:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }
      await enqueueLog({
        kind: "final",
        logId: `bg-${row.id}`,
        apiKeyId: row.apiKeyId,
        provider: row.provider,
        model: row.model,
        endpoint: "/v1/responses",
        latencyMs: 0,
        promptTokens: upstreamResponse.usage?.input_tokens,
        completionTokens: upstreamResponse.usage?.output_tokens,
        totalTokens: upstreamResponse.usage?.total_tokens,
        estimatedCost: undefined,
        statusCode: 200,
      } satisfies RequestLogJob);
    }
    return;
  }

  await prismaClient.backgroundResponseJob.update({
    where: { id: row.id },
    data: {
      status: upstreamStatus,
      response: upstreamResponse as object,
    },
  });

  await enqueue(job.jobId, job.attempt + 1, backoffMs(job.attempt + 1));
}

async function fetchUpstream(
  row: BackgroundJobRecord,
  fetchFn: typeof fetch,
): Promise<UpstreamResponse> {
  const url = buildUpstreamGetUrl(row);
  const response = await fetchFn(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const text = await response.text();
  if (!response.ok) {
    const err = new Error(
      `Background poll upstream error: ${response.status} - ${text}`,
    ) as UpstreamResponsesApiErrorLike;
    err.status = response.status;
    throw err;
  }

  try {
    return JSON.parse(text) as UpstreamResponse;
  } catch {
    return {};
  }
}

function buildUpstreamGetUrl(row: BackgroundJobRecord): string {
  if (row.provider === "azure-cognitive-services") {
    const endpoint = process.env.AZURE_OPENAI_RESPONSES_ENDPOINT;
    if (!endpoint) {
      throw new Error(
        "AZURE_OPENAI_RESPONSES_ENDPOINT is required to poll Azure background jobs",
      );
    }
    const normalized = endpoint.replace(/\/$/, "");
    const apiVersion =
      process.env.AZURE_OPENAI_RESPONSES_API_VERSION ?? "2025-04-01-preview";
    return `${normalized}/openai/v1/responses/${encodeURIComponent(row.id)}?api-version=${encodeURIComponent(apiVersion)}`;
  }
  return `https://api.openai.com/v1/responses/${encodeURIComponent(row.id)}`;
}

function computeCost(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  modelId: string,
): number | undefined {
  const pricing = lookupPricing(modelId);
  if (!pricing) return undefined;
  const inputCost = ((inputTokens ?? 0) * pricing.inputPricePer1M) / 1_000_000;
  const outputCost = ((outputTokens ?? 0) * pricing.outputPricePer1M) / 1_000_000;
  return inputCost + outputCost;
}

// Best-effort pricing for background billing. We only know the public model id
// (e.g. "openai:gpt-5"). For now we hardcode the most common Responses-capable
// models; everything else returns undefined and the spend write is skipped.
const KNOWN_BACKGROUND_PRICING: Record<string, { inputPricePer1M: number; outputPricePer1M: number }> = {
  "openai:gpt-5": { inputPricePer1M: 1.25, outputPricePer1M: 10 },
  "openai:gpt-5-mini": { inputPricePer1M: 0.25, outputPricePer1M: 2 },
  "openai:gpt-5-nano": { inputPricePer1M: 0.05, outputPricePer1M: 0.4 },
  "openai:gpt-4.1": { inputPricePer1M: 2, outputPricePer1M: 8 },
  "openai:gpt-4.1-mini": { inputPricePer1M: 0.4, outputPricePer1M: 1.6 },
  "openai:gpt-4.1-nano": { inputPricePer1M: 0.1, outputPricePer1M: 0.4 },
  "openai:gpt-4o": { inputPricePer1M: 2.5, outputPricePer1M: 10 },
  "openai:gpt-4o-mini": { inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
  "openai:o3": { inputPricePer1M: 2, outputPricePer1M: 8 },
  "openai:o3-mini": { inputPricePer1M: 1.1, outputPricePer1M: 4.4 },
  "openai:o4-mini": { inputPricePer1M: 1.1, outputPricePer1M: 4.4 },
  "azure-cognitive-services:gpt-5": { inputPricePer1M: 1.25, outputPricePer1M: 10 },
  "azure-cognitive-services:gpt-4o": { inputPricePer1M: 2.5, outputPricePer1M: 10 },
};

function lookupPricing(modelId: string):
  | { inputPricePer1M: number; outputPricePer1M: number }
  | undefined {
  return KNOWN_BACKGROUND_PRICING[modelId];
}

export async function startBackgroundResponseWorker(): Promise<
  Worker<BackgroundPollJob>
> {
  const workerConnection = new IORedis(
    process.env.REDIS_URL ?? "redis://localhost:6379",
    { maxRetriesPerRequest: null },
  );
  workerConnection.on("error", (error) => {
    console.error("Background poll worker Redis error:", error.message);
  });

  return new Worker<BackgroundPollJob>(
    BACKGROUND_POLL_QUEUE_NAME,
    async (bullJob) => {
      await processBackgroundPollJob(bullJob.data);
    },
    {
      connection: workerConnection,
      concurrency: Number(
        process.env.BACKGROUND_POLL_WORKER_CONCURRENCY ?? 5,
      ),
    },
  );
}

export { BACKGROUND_POLL_QUEUE_NAME, REQUEST_LOG_QUEUE_NAME };
