import type { ToolAnnotations, ToolContentBlock, ToolExecutionResult } from "@mux/core/types";
import { z } from "zod";
import type {
  DiscoveredMcpTool,
  JsonRpcId,
  UpstreamMcpClient,
  UpstreamMcpClientOptions,
  UpstreamMcpTarget,
} from "./types";

const MCP_PROTOCOL_VERSION = "2025-03-26";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_TOOL_LIST_PAGES = 50;

const BLOCKED_METADATA_HOSTS = new Set([
  "100.100.100.200",
  "metadata.google.internal",
  "metadata.goog",
  "fd00:ec2::254",
]);

const RESERVED_MCP_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "content-type",
  "accept",
  "mcp-session-id",
]);

const IPV4_LINK_LOCAL_PATTERN = /^169\.254\.\d{1,3}\.\d{1,3}$/;
const IPV6_MAPPED_LINK_LOCAL_PATTERN = /^::ffff:(?:169\.254\.\d{1,3}\.\d{1,3}|a9fe:[0-9a-f]{1,4})$/;
const IPV6_LINK_LOCAL_PATTERN = /^fe[89ab][0-9a-f]:/;

const jsonRpcEnvelopeSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.unknown().optional(),
      })
      .optional(),
  })
  .refine((env) => env.result !== undefined || env.error !== undefined, {
    message: "JSON-RPC response must contain either result or error.",
  });

const rawToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  annotations: z
    .object({
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
      openWorldHint: z.boolean().optional(),
    })
    .optional(),
});

const listToolsResultSchema = z.object({
  tools: z.array(rawToolSchema),
  nextCursor: z.string().optional(),
});

const rawContentBlockSchema = z.object({
  type: z.enum(["text", "image", "resource"]),
  text: z.string().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
  uri: z.string().optional(),
});

const callToolResultSchema = z.object({
  content: z.array(rawContentBlockSchema).default([]),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
});

export const isReservedMcpHeader = (headerName: string): boolean =>
  RESERVED_MCP_HEADERS.has(headerName.trim().toLowerCase());

const normalizeHostForCheck = (hostname: string): string => {
  let normalized = hostname.toLowerCase();

  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }

  while (normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
};

export const assertSafeUpstreamUrl = (rawUrl: string): URL => {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid upstream MCP URL '${rawUrl}'.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Upstream MCP URL must use http or https protocol.");
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error("Upstream MCP URL must not contain embedded credentials; use headers instead.");
  }

  const host = normalizeHostForCheck(parsed.hostname);

  if (
    BLOCKED_METADATA_HOSTS.has(host) ||
    IPV4_LINK_LOCAL_PATTERN.test(host) ||
    IPV6_MAPPED_LINK_LOCAL_PATTERN.test(host) ||
    IPV6_LINK_LOCAL_PATTERN.test(host)
  ) {
    throw new Error(`Upstream MCP host '${host}' is not allowed.`);
  }

  return parsed;
};

const readBoundedText = async (response: Response, maxBytes: number): Promise<string> => {
  const lengthHeader = response.headers.get("content-length");

  if (lengthHeader !== null) {
    const declared = Number.parseInt(lengthHeader, 10);

    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new Error(`Upstream MCP response exceeded ${maxBytes} bytes.`);
    }
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Upstream MCP response exceeded ${maxBytes} bytes.`);
      }

      chunks.push(value);
    }
  }

  const combined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(combined);
};

const parseSseForJsonRpc = (
  sseText: string,
  expectedId: JsonRpcId,
): z.infer<typeof jsonRpcEnvelopeSchema> => {
  const events = sseText.split(/\r?\n\r?\n/);

  for (const block of events) {
    const dataLines: string[] = [];

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) {
      continue;
    }

    const payload = dataLines.join("\n").trim();

    if (payload.length === 0 || payload === "[DONE]") {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(payload);
      const checked = jsonRpcEnvelopeSchema.safeParse(parsed);

      if (checked.success && checked.data.id === expectedId) {
        return checked.data;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Upstream MCP SSE stream did not contain a matching JSON-RPC response.");
};

const normalizeInputSchema = (
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  if (!schema || schema.type !== "object") {
    return {
      type: "object",
      properties: {},
    };
  }

  return schema;
};

const normalizeAnnotations = (
  raw: z.infer<typeof rawToolSchema>["annotations"],
): ToolAnnotations => {
  const annotations: ToolAnnotations = {
    readOnlyHint: raw?.readOnlyHint ?? false,
    destructiveHint: raw?.destructiveHint ?? false,
    idempotentHint: raw?.idempotentHint ?? false,
  };

  if (raw?.openWorldHint !== undefined) {
    annotations.openWorldHint = raw.openWorldHint;
  }

  return annotations;
};

const buildRequestHeaders = (
  customHeaders: Record<string, string> | undefined,
  sessionId?: string,
): Headers => {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });

  if (customHeaders) {
    for (const [key, value] of Object.entries(customHeaders)) {
      if (isReservedMcpHeader(key)) {
        throw new Error(`Header '${key}' is reserved and cannot be overridden.`);
      }

      headers.set(key, value);
    }
  }

  if (sessionId) {
    headers.set("mcp-session-id", sessionId);
  }

  return headers;
};

export const createUpstreamMcpClient = (
  options: UpstreamMcpClientOptions = {},
): UpstreamMcpClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  const assertSupportedTransport = (target: UpstreamMcpTarget): void => {
    if (target.transport !== "streamable_http") {
      throw new Error(`Transport '${target.transport}' is not supported; use streamable_http.`);
    }
  };

  const sendRpc = async (
    target: UpstreamMcpTarget,
    method: string,
    params: Record<string, unknown>,
    id: number,
    sessionId?: string,
  ): Promise<{ result: unknown; sessionId?: string }> => {
    assertSupportedTransport(target);

    const url = assertSafeUpstreamUrl(target.url);
    const timeoutMs = target.timeoutMs ?? defaultTimeoutMs;
    const headers = buildRequestHeaders(target.headers, sessionId);

    const response = await fetchImpl(url.toString(), {
      method: "POST",
      headers,
      redirect: "error",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Upstream MCP server returned HTTP ${response.status}.`);
    }

    const returnedSessionId = response.headers.get("mcp-session-id") ?? sessionId;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const rawText = await readBoundedText(response, maxResponseBytes);

    let envelope: z.infer<typeof jsonRpcEnvelopeSchema>;

    if (contentType.includes("text/event-stream")) {
      envelope = parseSseForJsonRpc(rawText, id);
    } else {
      const parsed: unknown = JSON.parse(rawText);

      envelope = jsonRpcEnvelopeSchema.parse(parsed);

      if (envelope.id !== id) {
        throw new Error("Upstream MCP JSON-RPC response id mismatch.");
      }
    }

    if (envelope.error) {
      throw new Error(`Upstream MCP error (${envelope.error.code}): ${envelope.error.message}`);
    }

    return {
      result: envelope.result,
      sessionId: returnedSessionId,
    };
  };

  const sendNotification = async (
    target: UpstreamMcpTarget,
    method: string,
    sessionId?: string,
  ): Promise<void> => {
    const url = assertSafeUpstreamUrl(target.url);
    const timeoutMs = target.timeoutMs ?? defaultTimeoutMs;
    const headers = buildRequestHeaders(target.headers, sessionId);

    try {
      const response = await fetchImpl(url.toString(), {
        method: "POST",
        headers,
        redirect: "error",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      await response.body?.cancel();
    } catch {
      void method;
    }
  };

  const initializeSession = async (target: UpstreamMcpTarget): Promise<string | undefined> => {
    const init = await sendRpc(
      target,
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "mux-client",
          version: "0.1.0",
        },
      },
      1,
    );

    await sendNotification(target, "notifications/initialized", init.sessionId);

    return init.sessionId;
  };

  return {
    listTools: async (target: UpstreamMcpTarget): Promise<DiscoveredMcpTool[]> => {
      const sessionId = await initializeSession(target);
      const discovered: DiscoveredMcpTool[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      let requestId = 2;

      for (let page = 0; page < MAX_TOOL_LIST_PAGES; page += 1) {
        const params: Record<string, unknown> = {};

        if (cursor !== undefined) {
          params.cursor = cursor;
        }

        const { result } = await sendRpc(target, "tools/list", params, requestId, sessionId);
        const parsed = listToolsResultSchema.parse(result);

        requestId += 1;

        for (const tool of parsed.tools) {
          discovered.push({
            name: tool.name,
            description: tool.description ?? "",
            inputSchema: normalizeInputSchema(tool.inputSchema),
            annotations: normalizeAnnotations(tool.annotations),
          });
        }

        if (!parsed.nextCursor) {
          return discovered;
        }

        if (seenCursors.has(parsed.nextCursor)) {
          throw new Error("Upstream MCP tools/list returned a cyclic pagination cursor.");
        }

        seenCursors.add(parsed.nextCursor);
        cursor = parsed.nextCursor;
      }

      throw new Error(
        `Upstream MCP tools/list exceeded maximum pagination limit (${MAX_TOOL_LIST_PAGES} pages).`,
      );
    },

    callTool: async (
      target: UpstreamMcpTarget,
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<ToolExecutionResult> => {
      const sessionId = await initializeSession(target);
      const { result } = await sendRpc(
        target,
        "tools/call",
        {
          name: toolName,
          arguments: args,
        },
        2,
        sessionId,
      );
      const parsed = callToolResultSchema.parse(result);
      const content: ToolContentBlock[] = parsed.content;
      const normalized: ToolExecutionResult = { content };

      if (parsed.structuredContent !== undefined) {
        normalized.structuredContent = parsed.structuredContent;
      }

      if (parsed.isError !== undefined) {
        normalized.isError = parsed.isError;
      }

      return normalized;
    },
  };
};
