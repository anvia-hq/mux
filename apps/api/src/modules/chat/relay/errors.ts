import {
  UpstreamOpenAICompatibleError,
  upstreamOpenAICompatibleStatusCode,
} from "../../../providers/openai-compatible-error";
import type { ChatRelayConfig } from "./config";
import { statusCodeMatches } from "./config";

export class ChatRelayTimeoutError extends Error {
  readonly phase: "first_byte" | "idle" | "non_stream";

  constructor(phase: "first_byte" | "idle" | "non_stream") {
    super(phase === "idle" ? "Upstream stream timed out while idle" : "Upstream request timed out");
    this.name = "ChatRelayTimeoutError";
    this.phase = phase;
  }
}

export class ChatRelayClientAbortError extends Error {
  constructor() {
    super("Client disconnected");
    this.name = "ChatRelayClientAbortError";
  }
}

export class ChatRelayProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatRelayProtocolError";
  }
}

export function relayErrorStatus(error: unknown): number {
  if (error instanceof ChatRelayTimeoutError) return 504;
  if (error instanceof UpstreamOpenAICompatibleError) return error.status;
  return 502;
}

export function isRetryableRelayError(
  error: unknown,
  config: ChatRelayConfig,
  clientSignal?: AbortSignal,
): boolean {
  if (clientSignal?.aborted || error instanceof ChatRelayClientAbortError) return false;
  if (error instanceof ChatRelayProtocolError) return false;
  if (error instanceof ChatRelayTimeoutError) return error.phase !== "idle";
  if (error instanceof UpstreamOpenAICompatibleError) {
    return statusCodeMatches(config.retryStatusCodes, error.status);
  }
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return error instanceof TypeError || error instanceof Error;
}

type OpenAIErrorEnvelope = {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
};

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

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function sanitizedRelayError(
  error: unknown,
  requestId: string,
): { status: number; body: OpenAIErrorEnvelope; retryAfter?: string } {
  const requestSuffix = ` (request_id: ${requestId})`;
  if (error instanceof UpstreamOpenAICompatibleError) {
    const parsed = error.jsonError;
    const record = objectRecord(parsed);
    const nested = objectRecord(record?.error) ?? record;
    const rawMessage =
      typeof nested?.message === "string"
        ? nested.message
        : typeof nested?.detail === "string"
          ? nested.detail
          : `bad response status code ${error.status}`;
    return {
      status: error.status,
      retryAfter: error.retryAfter,
      body: {
        error: {
          message: `${maskSensitiveText(rawMessage)}${requestSuffix}`,
          type: typeof nested?.type === "string" ? nested.type : "upstream_error",
          param: typeof nested?.param === "string" ? nested.param : null,
          code:
            typeof nested?.code === "string"
              ? nested.code
              : typeof nested?.status === "string"
                ? nested.status
                : "bad_response_status_code",
        },
      },
    };
  }

  const status = relayErrorStatus(error);
  const timeout = error instanceof ChatRelayTimeoutError;
  return {
    status,
    body: {
      error: {
        message: `${timeout ? error.message : "Upstream request failed"}${requestSuffix}`,
        type: timeout ? "timeout_error" : "upstream_error",
        param: null,
        code: timeout ? "upstream_timeout" : "upstream_request_failed",
      },
    },
  };
}

export function internalRelayErrorMessage(error: unknown): string {
  const status = upstreamOpenAICompatibleStatusCode(error);
  const message = error instanceof Error ? error.message : "Unknown upstream error";
  return maskSensitiveText(`${status}: ${message}`).slice(0, 2_048);
}
