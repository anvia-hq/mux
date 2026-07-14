import { UpstreamAnthropicMessagesApiError } from "../../../providers/anthropic";
import { statusCodeMatches } from "../../chat/relay/config";
import type { MessagesRelayConfig } from "./config";

export class MessagesRelayTimeoutError extends Error {
  constructor(readonly phase: "first_byte" | "idle" | "non_stream") {
    super(phase === "idle" ? "Upstream stream timed out while idle" : "Upstream request timed out");
    this.name = "MessagesRelayTimeoutError";
  }
}

export class MessagesRelayClientAbortError extends Error {
  constructor() {
    super("Client disconnected");
    this.name = "MessagesRelayClientAbortError";
  }
}

export class MessagesRelayProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessagesRelayProtocolError";
  }
}

export function messagesRelayStatus(error: unknown): number {
  if (error instanceof MessagesRelayClientAbortError) return 499;
  if (error instanceof MessagesRelayTimeoutError) return 504;
  if (error instanceof UpstreamAnthropicMessagesApiError) return error.status;
  return 502;
}

export function retryableMessagesError(
  error: unknown,
  config: MessagesRelayConfig,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted || error instanceof MessagesRelayClientAbortError) return false;
  if (error instanceof MessagesRelayTimeoutError) return error.phase !== "idle";
  if (error instanceof UpstreamAnthropicMessagesApiError) {
    return statusCodeMatches(config.retryStatusCodes, error.status);
  }
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return (
    error instanceof MessagesRelayProtocolError ||
    error instanceof TypeError ||
    error instanceof Error
  );
}

function maskSensitiveText(value: string): string {
  return value
    .replace(/\b(?:sk[-_]|mux_live_)[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(
      /((?:authorization|x-api-key|api[_ -]?key)\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, "$1[REDACTED]");
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function typeForStatus(status: number): string {
  if (status === 400) return "invalid_request_error";
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "not_found_error";
  if (status === 413) return "request_too_large";
  if (status === 429) return "rate_limit_error";
  if (status === 529) return "overloaded_error";
  return "api_error";
}

export type AnthropicErrorEnvelope = {
  type: "error";
  error: { type: string; message: string };
  request_id: string;
};

export function anthropicRelayError(
  error: unknown,
  requestId: string,
): { status: number; body: AnthropicErrorEnvelope; retryAfter?: string } {
  const suffix = ` (request_id: ${requestId})`;
  if (error instanceof UpstreamAnthropicMessagesApiError) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(error.body);
    } catch {
      parsed = undefined;
    }
    const outer = record(parsed);
    const nested = record(outer?.error) ?? outer;
    const message =
      typeof nested?.message === "string"
        ? nested.message
        : `Upstream request failed with status ${error.status}`;
    return {
      status: error.status,
      retryAfter: error.retryAfter ?? undefined,
      body: {
        type: "error",
        error: {
          type: typeof nested?.type === "string" ? nested.type : typeForStatus(error.status),
          message: `${maskSensitiveText(message)}${suffix}`,
        },
        request_id: requestId,
      },
    };
  }

  const status = messagesRelayStatus(error);
  const timeout = error instanceof MessagesRelayTimeoutError;
  const aborted = error instanceof MessagesRelayClientAbortError;
  return {
    status,
    body: {
      type: "error",
      error: {
        type: timeout ? "timeout_error" : aborted ? "request_aborted" : "api_error",
        message: `${timeout || aborted ? error.message : "Upstream request failed"}${suffix}`,
      },
      request_id: requestId,
    },
  };
}

export function anthropicErrorBody(
  message: string,
  requestId: string,
  type = "invalid_request_error",
): AnthropicErrorEnvelope {
  return {
    type: "error",
    error: { type, message: `${message} (request_id: ${requestId})` },
    request_id: requestId,
  };
}
