import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "./prisma";
import {
  BACKGROUND_POLL_QUEUE_NAME,
  backgroundPollConnection,
  enqueueBackgroundPoll,
  type BackgroundPollJob,
} from "./background-response-queue";
import { enqueueRequestLog, REQUEST_LOG_QUEUE_NAME, type RequestLogJob } from "./request-log-queue";
import {
  ProviderKeyUnavailableError,
  readProviderApiKey,
  readProviderHeaders,
} from "./provider-keys";

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
  getProviderApiKey: (provider: string, channelId?: string | null) => Promise<string>;
  getProviderHeaders: (
    provider: string,
    channelId: string | null | undefined,
    apiKey: string,
  ) => Promise<Record<string, string>>;
  prismaClient: typeof prisma;
};

const defaultDeps: ProcessDeps = {
  fetch: (...args) => fetch(...args),
  redis: backgroundPollConnection,
  now: () => new Date(),
  enqueue: enqueueBackgroundPoll,
  enqueueLog: enqueueRequestLog,
  getProviderApiKey: readProviderApiKey,
  getProviderHeaders: readProviderHeaders,
  prismaClient: prisma,
};

type BackgroundJobRecord = {
  id: string;
  apiKeyId: string;
  provider: string;
  model: string;
  channelId?: string | null;
  channelName?: string | null;
  status: string;
  response: unknown;
  inputPricePer1M?: number | null;
  outputPricePer1M?: number | null;
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

class BackgroundPollConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackgroundPollConfigurationError";
  }
}

export async function processBackgroundPollJob(
  job: BackgroundPollJob,
  deps: Partial<ProcessDeps> = {},
): Promise<void> {
  const {
    fetch: fetchFn,
    redis,
    now,
    enqueue,
    enqueueLog,
    getProviderApiKey,
    getProviderHeaders,
    prismaClient,
  } = {
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
    upstreamResponse = await fetchUpstream(row, fetchFn, getProviderApiKey, getProviderHeaders);
  } catch (error) {
    const apiError = error as UpstreamResponsesApiErrorLike;
    if (
      error instanceof ProviderKeyUnavailableError ||
      error instanceof BackgroundPollConfigurationError
    ) {
      await failBackgroundJob(row.id, error.message, now, prismaClient);
      return;
    }
    if (typeof apiError.status === "number" && apiError.status === 404) {
      await failBackgroundJob(row.id, "upstream 404 while polling", now, prismaClient);
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
      let estimatedCost: number | undefined;
      if (usage?.input_tokens || usage?.output_tokens) {
        estimatedCost = computeCost(usage.input_tokens, usage.output_tokens, row);
        if (estimatedCost !== undefined && Number.isFinite(estimatedCost) && estimatedCost > 0) {
          try {
            await redis.incrbyfloat(`apikey_spend:${row.apiKeyId}`, estimatedCost);
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
        channelId: row.channelId ?? undefined,
        channelName: row.channelName ?? undefined,
        endpoint: "/v1/responses",
        latencyMs: 0,
        promptTokens: upstreamResponse.usage?.input_tokens,
        completionTokens: upstreamResponse.usage?.output_tokens,
        totalTokens: upstreamResponse.usage?.total_tokens,
        reasoningTokens: readReasoningTokens(upstreamResponse.usage),
        estimatedCost,
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
  getProviderApiKey: (provider: string, channelId?: string | null) => Promise<string>,
  getProviderHeaders: (
    provider: string,
    channelId: string | null | undefined,
    apiKey: string,
  ) => Promise<Record<string, string>>,
): Promise<UpstreamResponse> {
  const url = buildUpstreamGetUrl(row);
  const apiKey = await getProviderApiKey(row.provider, row.channelId);
  const channelHeaders = await getProviderHeaders(row.provider, row.channelId, apiKey);
  const response = await fetchFn(url, {
    method: "GET",
    headers: mergeHeaders(
      { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      channelHeaders,
    ),
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

function mergeHeaders(
  baseHeaders: Record<string, string>,
  overrideHeaders: Record<string, string>,
): Record<string, string> {
  const result = { ...baseHeaders };
  for (const [key, value] of Object.entries(overrideHeaders)) {
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (!trimmedKey || !trimmedValue) continue;
    for (const existingKey of Object.keys(result)) {
      if (existingKey.toLowerCase() === trimmedKey.toLowerCase()) {
        delete result[existingKey];
      }
    }
    result[trimmedKey] = trimmedValue;
  }
  return result;
}

function buildUpstreamGetUrl(row: BackgroundJobRecord): string {
  if (row.provider === "azure-cognitive-services") {
    const endpoint = process.env.AZURE_OPENAI_RESPONSES_ENDPOINT;
    if (!endpoint) {
      throw new BackgroundPollConfigurationError(
        "AZURE_OPENAI_RESPONSES_ENDPOINT is required to poll Azure background jobs",
      );
    }
    const normalized = endpoint.replace(/\/$/, "");
    const apiVersion = process.env.AZURE_OPENAI_RESPONSES_API_VERSION ?? "2025-04-01-preview";
    return `${normalized}/openai/v1/responses/${encodeURIComponent(row.id)}?api-version=${encodeURIComponent(apiVersion)}`;
  }
  return `https://api.openai.com/v1/responses/${encodeURIComponent(row.id)}`;
}

function computeCost(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  row: BackgroundJobRecord,
): number | undefined {
  const { inputPricePer1M, outputPricePer1M } = row;
  if (
    typeof inputPricePer1M !== "number" ||
    typeof outputPricePer1M !== "number" ||
    !Number.isFinite(inputPricePer1M) ||
    !Number.isFinite(outputPricePer1M)
  ) {
    return undefined;
  }
  const inputCost = ((inputTokens ?? 0) * inputPricePer1M) / 1_000_000;
  const outputCost = ((outputTokens ?? 0) * outputPricePer1M) / 1_000_000;
  return inputCost + outputCost;
}

function readReasoningTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const details = (usage as { output_tokens_details?: unknown }).output_tokens_details;
  if (!details || typeof details !== "object") return undefined;
  const reasoning = (details as { reasoning_tokens?: unknown }).reasoning_tokens;
  return typeof reasoning === "number" && Number.isFinite(reasoning) ? reasoning : undefined;
}

async function failBackgroundJob(
  id: string,
  errorMessage: string,
  now: () => Date,
  prismaClient: typeof prisma,
): Promise<void> {
  await prismaClient.backgroundResponseJob.update({
    where: { id },
    data: {
      status: "failed",
      errorMessage,
      completedAt: now(),
    },
  });
}

export async function startBackgroundResponseWorker(): Promise<Worker<BackgroundPollJob>> {
  const workerConnection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
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
      concurrency: Number(process.env.BACKGROUND_POLL_WORKER_CONCURRENCY ?? 5),
    },
  );
}

export { BACKGROUND_POLL_QUEUE_NAME, REQUEST_LOG_QUEUE_NAME };
