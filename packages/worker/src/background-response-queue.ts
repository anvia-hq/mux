import { Queue } from "bullmq";
import IORedis from "ioredis";

export const BACKGROUND_POLL_QUEUE_NAME = "background-response-poll";

export type BackgroundPollJob = {
  jobId: string;
  attempt: number;
};

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const backgroundPollConnection = new IORedis(redisUrl, {
  connectTimeout: 1000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 100, 500);
  },
});

backgroundPollConnection.on("error", (error) => {
  console.error("Background poll queue Redis error:", error.message);
});

export const backgroundPollQueue = new Queue<BackgroundPollJob>(BACKGROUND_POLL_QUEUE_NAME, {
  connection: backgroundPollConnection,
  defaultJobOptions: {
    attempts: 20,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60,
    },
  },
});

export async function enqueueBackgroundPoll(
  jobId: string,
  attempt: number,
  delayMs: number,
): Promise<void> {
  await backgroundPollQueue.add(
    "poll",
    { jobId, attempt },
    {
      // BullMQ reserves ":" for its own Redis key namespace.
      jobId: `bg-poll-${jobId}-${attempt}`,
      delay: delayMs,
    },
  );
}

export async function closeBackgroundPollQueue(): Promise<void> {
  await backgroundPollQueue.close();
  await backgroundPollConnection.quit();
}
