import { createServer } from "node:http";
import { closeRequestLogQueue } from "../../packages/worker/src/request-log-queue";
import { startRequestLogWorker } from "../../packages/worker/src/request-log-worker";

const port = Number(process.env.E2E_REQUEST_LOG_WORKER_PORT ?? "8020");
const worker = await startRequestLogWorker();

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
});

await new Promise<void>((resolve) => {
  server.listen(port, "127.0.0.1", resolve);
});

console.log(`E2E request log worker listening on http://127.0.0.1:${port}/health`);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`E2E request log worker received ${signal}`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await worker.close();
  await closeRequestLogQueue();
}

process.on("SIGTERM", (signal) => {
  void shutdown(signal).then(() => process.exit(0));
});

process.on("SIGINT", (signal) => {
  void shutdown(signal).then(() => process.exit(0));
});
