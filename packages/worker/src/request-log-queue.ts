import { Queue } from "bullmq";
import IORedis from "ioredis";

export type RequestLogPayload = {
  logId: string;
  apiKeyId: string;
  provider: string;
  model: string;
  requestedModel?: string;
  channelId?: string;
  channelName?: string;
  endpoint: string;
  latencyMs: number;
  providerLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  estimatedCost?: number;
  pricingInputTokens?: number;
  appliedInputPricePer1M?: number;
  appliedOutputPricePer1M?: number;
  appliedPricingTierThreshold?: number;
  statusCode: number;
  errorMessage?: string;
};

export type RequestLogJob =
  | ({ kind: "final" } & RequestLogPayload)
  | ({ kind: "stream-start" } & RequestLogPayload)
  | ({ kind: "stream-finalize" } & RequestLogPayload);

export const REQUEST_LOG_QUEUE_NAME = "request-log";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const queueConnection = new IORedis(redisUrl, {
  connectTimeout: 1000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 100, 500);
  },
});

queueConnection.on("error", (error) => {
  console.error("Request log queue Redis error:", error.message);
});

export const requestLogQueue = new Queue<RequestLogJob>(REQUEST_LOG_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 8,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      age: 60 * 60,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60,
    },
  },
});

export async function enqueueRequestLog(job: RequestLogJob): Promise<void> {
  await requestLogQueue.add(job.kind, job, {
    // BullMQ reserves ":" for its own Redis key namespace and rejects it in custom job ids.
    jobId: `${job.kind}-${job.logId}`,
  });
}

export async function closeRequestLogQueue(): Promise<void> {
  await requestLogQueue.close();
  await queueConnection.quit();
}
