import "./env";

export {
  closeRequestLogQueue,
  enqueueRequestLog,
  REQUEST_LOG_QUEUE_NAME,
  requestLogQueue,
  type RequestLogJob,
  type RequestLogPayload,
} from "./request-log-queue";

export {
  BACKGROUND_POLL_QUEUE_NAME,
  backgroundPollQueue,
  closeBackgroundPollQueue,
  enqueueBackgroundPoll,
  type BackgroundPollJob,
} from "./background-response-queue";

export {
  backoffMs,
  processBackgroundPollJob,
  startBackgroundResponseWorker,
} from "./background-response-worker";

if (import.meta.url === `file://${process.argv[1]}`) {
  const [
    { startRequestLogWorker },
    { closeRequestLogQueue },
    { startBackgroundResponseWorker },
    { closeBackgroundPollQueue },
  ] = await Promise.all([
    import("./request-log-worker"),
    import("./request-log-queue"),
    import("./background-response-worker"),
    import("./background-response-queue"),
  ]);

  const requestLogWorker = await startRequestLogWorker();
  const backgroundPollWorker = await startBackgroundResponseWorker();

  requestLogWorker.on("completed", (job) => {
    console.log(`Request log job ${job.id} completed`);
  });
  requestLogWorker.on("failed", (job, error) => {
    console.error(`Request log job ${job?.id} failed`, error);
  });

  backgroundPollWorker.on("completed", (job) => {
    console.log(`Background poll job ${job.id} completed`);
  });
  backgroundPollWorker.on("failed", (job, error) => {
    console.error(`Background poll job ${job?.id} failed`, error);
  });

  const shutdown = async () => {
    await Promise.all([requestLogWorker.close(), backgroundPollWorker.close()]);
    await Promise.all([closeRequestLogQueue(), closeBackgroundPollQueue()]);
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });

  process.on("SIGINT", () => {
    void shutdown();
  });
}
