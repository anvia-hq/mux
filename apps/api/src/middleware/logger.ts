import { randomUUID } from "node:crypto";
import { enqueueRequestLog, type RequestLogPayload } from "@repo/worker";
import { estimateCostDetails } from "../providers/registry";

export interface LogEntry {
  logId?: string;
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
  /** Input token count used only for selecting a whole-request pricing tier. */
  pricingInputTokens?: number;
  statusCode: number;
  errorMessage?: string;
}

export class RequestLoggingUnavailableError extends Error {
  constructor(cause: unknown) {
    super("request logging unavailable");
    this.name = "RequestLoggingUnavailableError";
    this.cause = cause;
  }
}

function toPayload(entry: LogEntry): RequestLogPayload {
  const pricingDetails =
    entry.estimatedCost === undefined
      ? undefined
      : estimateCostDetails(
          entry.model,
          entry.promptTokens,
          entry.completionTokens,
          entry.pricingInputTokens,
        );
  return {
    ...entry,
    pricingInputTokens: pricingDetails?.pricingInputTokens,
    appliedInputPricePer1M: pricingDetails?.appliedInputPricePer1M,
    appliedOutputPricePer1M: pricingDetails?.appliedOutputPricePer1M,
    appliedPricingTierThreshold: pricingDetails?.appliedPricingTierThreshold ?? undefined,
    logId: entry.logId ?? randomUUID(),
  };
}

export async function logRequest(entry: LogEntry): Promise<string> {
  const payload = toPayload(entry);

  try {
    await enqueueRequestLog({ kind: "final", ...payload });
  } catch (error) {
    throw new RequestLoggingUnavailableError(error);
  }

  return payload.logId;
}

export async function logStreamStart(entry: LogEntry): Promise<string> {
  const payload = toPayload({
    ...entry,
    latencyMs: 0,
    statusCode: 102,
  });

  try {
    await enqueueRequestLog({ kind: "stream-start", ...payload });
  } catch (error) {
    throw new RequestLoggingUnavailableError(error);
  }

  return payload.logId;
}

export async function logStreamFinal(entry: LogEntry & { logId: string }): Promise<void> {
  try {
    await enqueueRequestLog({ kind: "stream-finalize", ...toPayload(entry) });
  } catch (error) {
    throw new RequestLoggingUnavailableError(error);
  }
}
