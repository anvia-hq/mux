import { prisma } from "../utils/prisma";
import { estimateCost } from "../providers/registry";

export interface LogEntry {
  apiKeyId: string;
  provider: string;
  model: string;
  endpoint: string;
  latencyMs: number;
  providerLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  statusCode: number;
  errorMessage?: string;
}

const logBuffer: LogEntry[] = [];
const FLUSH_INTERVAL_MS = 2000; // 2 seconds
const MAX_BUFFER_SIZE = 100;
const MAX_RETRY_BUFFER_SIZE = MAX_BUFFER_SIZE * 2;

let flushTimer: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;

function startFlushTimer(): void {
  if (flushTimer) return;

  flushTimer = setInterval(() => {
    void flushLogs();
  }, FLUSH_INTERVAL_MS);

  // Allow Node.js to exit even if timer is running
  if (typeof flushTimer.unref === "function") {
    flushTimer.unref();
  }
}

async function flushLogs(): Promise<void> {
  if (logBuffer.length === 0) return;

  // Atomically take all pending entries so concurrent logRequest() calls
  // don't race with the flush.
  const entries = logBuffer.splice(0, logBuffer.length);

  try {
    await prisma.requestLog.createMany({
      data: entries.map((entry) => ({
        apiKeyId: entry.apiKeyId,
        provider: entry.provider,
        model: entry.model,
        endpoint: entry.endpoint,
        latencyMs: entry.latencyMs,
        providerLatencyMs: entry.providerLatencyMs,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        totalTokens: entry.totalTokens,
        estimatedCost: estimateCost(entry.model, entry.promptTokens, entry.completionTokens),
        statusCode: entry.statusCode,
        errorMessage: entry.errorMessage,
      })),
    });
  } catch (error) {
    console.error("Failed to flush logs:", error);
    // Re-add failed entries to the front of the buffer (up to a cap to
    // avoid unbounded memory growth if the database is down for long periods).
    const space = Math.max(0, MAX_RETRY_BUFFER_SIZE - logBuffer.length);
    if (space > 0) {
      logBuffer.unshift(...entries.slice(0, space));
    }
  }
}

/**
 * Buffer a log entry to be flushed asynchronously to the database.
 * Flushes happen every 2 seconds or once 100 entries accumulate, whichever comes first.
 */
export function logRequest(entry: LogEntry): void {
  if (isShuttingDown) {
    // During shutdown we still want to attempt to persist, so do not drop.
    logBuffer.push(entry);
    return;
  }

  logBuffer.push(entry);
  startFlushTimer();

  // Force flush when buffer hits the high-water mark.
  if (logBuffer.length >= MAX_BUFFER_SIZE) {
    void flushLogs();
  }
}

/**
 * Drain the in-memory buffer. Safe to call multiple times.
 * Exposed for graceful shutdown handlers and tests.
 */
export async function flushLogBuffer(): Promise<void> {
  await flushLogs();
}

/**
 * Stop the background flush timer. Buffer is left intact so it can be drained
 * via flushLogBuffer() before the process exits.
 */
export function stopLogFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

// Graceful shutdown: drain remaining log entries on SIGTERM/SIGINT
// so that in-flight requests are not lost when the process is stopped.
async function shutdown(): Promise<void> {
  isShuttingDown = true;
  stopLogFlushTimer();
  try {
    await flushLogBuffer();
  } catch (error) {
    console.error("Error flushing logs during shutdown:", error);
  }
}

process.on("SIGTERM", () => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});
