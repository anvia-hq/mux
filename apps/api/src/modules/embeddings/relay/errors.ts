import { UpstreamOpenAICompatibleError } from "../../../providers/openai-compatible-error";
import { statusCodeMatches } from "../../chat/relay/config";
import type { EmbeddingsRelayConfig } from "./config";

export class EmbeddingsRelayTimeoutError extends Error {
  constructor() {
    super("Upstream request timed out");
    this.name = "EmbeddingsRelayTimeoutError";
  }
}

export class EmbeddingsRelayClientAbortError extends Error {
  constructor() {
    super("Client disconnected");
    this.name = "EmbeddingsRelayClientAbortError";
  }
}

export class EmbeddingsRelayProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingsRelayProtocolError";
  }
}

export function embeddingsRelayStatus(error: unknown): number {
  if (error instanceof EmbeddingsRelayClientAbortError) return 499;
  if (error instanceof EmbeddingsRelayTimeoutError) return 504;
  if (error instanceof UpstreamOpenAICompatibleError) return error.status;
  return 502;
}

export function retryableEmbeddingsError(
  error: unknown,
  config: EmbeddingsRelayConfig,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted || error instanceof EmbeddingsRelayClientAbortError) return false;
  if (error instanceof EmbeddingsRelayTimeoutError) return true;
  if (error instanceof UpstreamOpenAICompatibleError) {
    return statusCodeMatches(config.retryStatusCodes, error.status);
  }
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return error instanceof EmbeddingsRelayProtocolError || error instanceof TypeError;
}
