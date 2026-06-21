import "./env";

export {
  closeRequestLogQueue,
  enqueueRequestLog,
  REQUEST_LOG_QUEUE_NAME,
  requestLogQueue,
  type RequestLogJob,
  type RequestLogPayload,
} from "./request-log-queue";

if (import.meta.url === `file://${process.argv[1]}`) {
  const [{ startRequestLogWorker }, { closeRequestLogQueue }] = await Promise.all([
    import("./request-log-worker"),
    import("./request-log-queue"),
  ]);
  const worker = await startRequestLogWorker();

  worker.on("completed", (job) => {
    console.log(`Request log job ${job.id} completed`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Request log job ${job?.id} failed`, error);
  });

  const shutdown = async () => {
    await worker.close();
    await closeRequestLogQueue();
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });

  process.on("SIGINT", () => {
    void shutdown();
  });
}
