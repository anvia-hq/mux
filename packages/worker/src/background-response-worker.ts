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
  request?: unknown;
  channelId?: string | null;
  channelName?: string | null;
  status: string;
  response: unknown;
  inputPricePer1M?: number | null;
  outputPricePer1M?: number | null;
  pricingTiers?: unknown;
  upstreamUrl?: string | null;
  spendReservationId?: string | null;
  spendReservedUsd?: number | null;
  spendOwnerId?: string | null;
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
    await finalizeStoredTerminalReservation(row, redis);
    if (row.spendReservationId) {
      await prismaClient.backgroundResponseJob.update({
        where: { id: row.id },
        data: {
          spendReservationId: null,
          spendReservedUsd: null,
          spendOwnerId: null,
        },
      });
    }
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
      await refundBackgroundReservation(row, redis);
      await failBackgroundJob(row.id, error.message, now, prismaClient);
      return;
    }
    if (typeof apiError.status === "number" && apiError.status === 404) {
      await refundBackgroundReservation(row, redis);
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
      spendReservationId: null,
      spendReservedUsd: null,
      spendOwnerId: null,
    };
    if (upstreamStatus === "failed") {
      updateData.errorMessage =
        typeof upstreamResponse.error === "object" && upstreamResponse.error !== null
          ? JSON.stringify(upstreamResponse.error)
          : "upstream reported failed";
    }
    if (upstreamStatus === "completed") {
      const usage = upstreamResponse.usage;
      let estimatedCost: number | undefined;
      let pricingDetails: ReturnType<typeof computeCostDetails> | undefined;
      if (hasReportedUsage(usage)) {
        pricingDetails = computeCostDetails(usage.input_tokens, usage.output_tokens, row);
        estimatedCost = pricingDetails?.estimatedCost;
      }

      const settledCost = estimatedCost ?? row.spendReservedUsd ?? undefined;
      if (row.spendReservationId) {
        await settleBackgroundReservation(row, settledCost, redis);
      } else if (
        estimatedCost !== undefined &&
        Number.isFinite(estimatedCost) &&
        estimatedCost > 0
      ) {
        try {
          const apiKey = await prismaClient.apiKey.findUnique({
            where: { id: row.apiKeyId },
            select: { createdBy: true },
          });
          const transaction = redis
            .multi()
            .incrbyfloat(`apikey_spend:${row.apiKeyId}`, estimatedCost);

          if (apiKey) {
            transaction.incrbyfloat(`user_spend:${apiKey.createdBy}`, estimatedCost);
          }

          const results = await transaction.exec();
          if (!results) {
            throw new Error("Redis transaction aborted");
          }

          for (const [commandError] of results) {
            if (commandError) {
              throw commandError;
            }
          }
        } catch (error) {
          console.error(
            `Failed to bill background response ${row.id}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      await enqueueLog({
        kind: "final",
        logId: `bg-${row.id}`,
        apiKeyId: row.apiKeyId,
        provider: row.provider,
        model: row.model,
        requestedModel: readRequestedModel(row.request),
        channelId: row.channelId ?? undefined,
        channelName: row.channelName ?? undefined,
        endpoint: "/v1/responses",
        latencyMs: 0,
        promptTokens: upstreamResponse.usage?.input_tokens,
        completionTokens: upstreamResponse.usage?.output_tokens,
        totalTokens: upstreamResponse.usage?.total_tokens,
        reasoningTokens: readReasoningTokens(upstreamResponse.usage),
        estimatedCost: estimatedCost ?? row.spendReservedUsd ?? undefined,
        pricingInputTokens: pricingDetails?.pricingInputTokens,
        appliedInputPricePer1M: pricingDetails?.appliedInputPricePer1M,
        appliedOutputPricePer1M: pricingDetails?.appliedOutputPricePer1M,
        appliedPricingTierThreshold: pricingDetails?.appliedPricingTierThreshold ?? undefined,
        statusCode: 200,
      } satisfies RequestLogJob);
    } else {
      await refundBackgroundReservation(row, redis);
    }
    await prismaClient.backgroundResponseJob.update({
      where: { id: row.id },
      data: updateData,
    });
    return;
  }

  await prismaClient.backgroundResponseJob.update({
    where: { id: row.id },
    data: {
      status: upstreamStatus,
      response: upstreamResponse as object,
    },
  });

  await refreshBackgroundReservation(row, redis);
  await enqueue(job.jobId, job.attempt + 1, backoffMs(job.attempt + 1));
}

function readRequestedModel(request: unknown): string | undefined {
  if (!request || typeof request !== "object") return undefined;
  const model = (request as { model?: unknown }).model;
  return typeof model === "string" ? model : undefined;
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
  if (row.upstreamUrl) return row.upstreamUrl;
  if (row.provider === "azure-cognitive-services" || row.provider === "azure") {
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

const RESERVATION_TTL_SECONDS = 24 * 60 * 60;

function hasReportedUsage(
  usage: UpstreamResponse["usage"],
): usage is NonNullable<UpstreamResponse["usage"]> {
  return typeof usage?.input_tokens === "number" || typeof usage?.output_tokens === "number";
}

async function finalizeStoredTerminalReservation(
  row: BackgroundJobRecord,
  redis: IORedis,
): Promise<void> {
  if (!row.spendReservationId) return;
  if (row.status !== "completed") {
    await refundBackgroundReservation(row, redis);
    return;
  }

  const response =
    row.response && typeof row.response === "object"
      ? (row.response as UpstreamResponse)
      : undefined;
  const usage = response?.usage;
  const estimatedCost = hasReportedUsage(usage)
    ? computeCostDetails(usage?.input_tokens, usage?.output_tokens, row)?.estimatedCost
    : undefined;
  await settleBackgroundReservation(row, estimatedCost ?? row.spendReservedUsd ?? undefined, redis);
}

function reservationKeys(row: BackgroundJobRecord): [string, string, string] | null {
  if (!row.spendReservationId) return null;
  return [
    `apikey_spend:${row.apiKeyId}`,
    row.spendOwnerId
      ? `user_spend:${row.spendOwnerId}`
      : `chat_spend:no_owner:${row.spendReservationId}`,
    `chat_spend_reservation:${row.spendReservationId}`,
  ];
}

async function refreshBackgroundReservation(row: BackgroundJobRecord, redis: IORedis) {
  const keys = reservationKeys(row);
  if (!keys) return;
  await redis.expire(keys[2], RESERVATION_TTL_SECONDS);
}

async function settleBackgroundReservation(
  row: BackgroundJobRecord,
  actualUsd: number | undefined,
  redis: IORedis,
) {
  const keys = reservationKeys(row);
  if (!keys) return;
  const actual =
    actualUsd !== undefined && Number.isFinite(actualUsd) && actualUsd >= 0
      ? actualUsd
      : (row.spendReservedUsd ?? 0);
  const result = await redis.eval(
    `
local state = redis.call('HGET', KEYS[3], 'state')
if state == 'settled' or state == 'refunded' then return {1, state} end
if state ~= 'pending' then return {0, 'not_pending'} end
local current = tonumber(redis.call('HGET', KEYS[3], 'amount') or '0')
local actual = tonumber(ARGV[1])
local delta = actual - current
if delta ~= 0 then
  redis.call('INCRBYFLOAT', KEYS[1], delta)
  if ARGV[2] == '1' then redis.call('INCRBYFLOAT', KEYS[2], delta) end
end
redis.call('HSET', KEYS[3], 'state', 'settled', 'actual', actual)
redis.call('EXPIRE', KEYS[3], ARGV[3])
return {1, tostring(actual)}
`,
    3,
    ...keys,
    String(actual),
    row.spendOwnerId ? "1" : "0",
    String(RESERVATION_TTL_SECONDS),
  );
  if (!Array.isArray(result) || (result[0] !== 1 && result[0] !== "1")) {
    throw new Error("background spend reservation could not be settled");
  }
}

async function refundBackgroundReservation(row: BackgroundJobRecord, redis: IORedis) {
  const keys = reservationKeys(row);
  if (!keys) return;
  try {
    const result = await redis.eval(
      `
local state = redis.call('HGET', KEYS[3], 'state')
if state == 'refunded' or state == 'settled' then return {1, state} end
if state ~= 'pending' then return {0, 'not_pending'} end
local amount = tonumber(redis.call('HGET', KEYS[3], 'amount') or '0')
redis.call('SET', KEYS[1], math.max(tonumber(redis.call('GET', KEYS[1]) or '0') - amount, 0))
if ARGV[1] == '1' then
  redis.call('SET', KEYS[2], math.max(tonumber(redis.call('GET', KEYS[2]) or '0') - amount, 0))
end
redis.call('HSET', KEYS[3], 'state', 'refunded', 'actual', 0)
redis.call('EXPIRE', KEYS[3], ARGV[2])
return {1, 'refunded'}
`,
      3,
      ...keys,
      row.spendOwnerId ? "1" : "0",
      String(RESERVATION_TTL_SECONDS),
    );
    if (!Array.isArray(result) || (result[0] !== 1 && result[0] !== "1")) {
      throw new Error("background spend reservation could not be refunded");
    }
  } catch (error) {
    console.error(
      `Failed to refund background response ${row.id}:`,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

type PricingTier = {
  inputTokenThreshold: number;
  inputPricePer1M: number;
  outputPricePer1M: number;
};

function computeCostDetails(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  row: BackgroundJobRecord,
):
  | {
      estimatedCost: number;
      pricingInputTokens: number;
      appliedInputPricePer1M: number;
      appliedOutputPricePer1M: number;
      appliedPricingTierThreshold: number | null;
    }
  | undefined {
  const { inputPricePer1M, outputPricePer1M } = row;
  if (
    typeof inputPricePer1M !== "number" ||
    typeof outputPricePer1M !== "number" ||
    !Number.isFinite(inputPricePer1M) ||
    !Number.isFinite(outputPricePer1M)
  ) {
    return undefined;
  }
  const pricingInputTokens = inputTokens ?? 0;
  const selectedTier = readPricingTiers(row.pricingTiers)
    .filter((tier) => pricingInputTokens > tier.inputTokenThreshold)
    .at(-1);
  const appliedInputPricePer1M = selectedTier?.inputPricePer1M ?? inputPricePer1M;
  const appliedOutputPricePer1M = selectedTier?.outputPricePer1M ?? outputPricePer1M;
  const inputCost = (pricingInputTokens * appliedInputPricePer1M) / 1_000_000;
  const outputCost = ((outputTokens ?? 0) * appliedOutputPricePer1M) / 1_000_000;
  return {
    estimatedCost: inputCost + outputCost,
    pricingInputTokens,
    appliedInputPricePer1M,
    appliedOutputPricePer1M,
    appliedPricingTierThreshold: selectedTier?.inputTokenThreshold ?? null,
  };
}

function readPricingTiers(value: unknown): PricingTier[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (tier): tier is PricingTier =>
        Boolean(tier) &&
        typeof tier === "object" &&
        typeof (tier as PricingTier).inputTokenThreshold === "number" &&
        typeof (tier as PricingTier).inputPricePer1M === "number" &&
        typeof (tier as PricingTier).outputPricePer1M === "number",
    )
    .sort((left, right) => left.inputTokenThreshold - right.inputTokenThreshold);
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
      spendReservationId: null,
      spendReservedUsd: null,
      spendOwnerId: null,
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
