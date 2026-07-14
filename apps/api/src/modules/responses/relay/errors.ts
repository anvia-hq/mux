import { UpstreamOpenAICompatibleError } from "../../../providers/openai-compatible-error";
import { statusCodeMatches } from "../../chat/relay/config";
import type { ResponsesRelayConfig } from "./config";

export class ResponsesRelayTimeoutError extends Error {
  constructor(readonly phase: "first_byte" | "idle" | "non_stream") {
    super(phase === "idle" ? "Upstream stream timed out while idle" : "Upstream request timed out");
    this.name = "ResponsesRelayTimeoutError";
  }
}

export class ResponsesRelayClientAbortError extends Error {
  constructor() {
    super("Client disconnected");
    this.name = "ResponsesRelayClientAbortError";
  }
}

export class ResponsesRelayProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponsesRelayProtocolError";
  }
}

export function responsesRelayStatus(error: unknown): number {
  if (error instanceof ResponsesRelayClientAbortError) return 499;
  if (error instanceof ResponsesRelayTimeoutError) return 504;
  if (error instanceof UpstreamOpenAICompatibleError) return error.status;
  return 502;
}

export function retryableResponsesError(
  error: unknown,
  config: ResponsesRelayConfig,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted || error instanceof ResponsesRelayClientAbortError) return false;
  if (error instanceof ResponsesRelayTimeoutError) return error.phase !== "idle";
  if (error instanceof UpstreamOpenAICompatibleError) {
    return statusCodeMatches(config.retryStatusCodes, error.status);
  }
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return (
    error instanceof ResponsesRelayProtocolError ||
    error instanceof TypeError ||
    error instanceof Error
  );
}
