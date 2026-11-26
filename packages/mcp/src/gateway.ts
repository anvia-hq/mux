import type { CanonicalTool } from "@mux/core/types";
import { z } from "zod";
import type { JsonRpcId, JsonRpcResponse, McpGatewayContext, McpGatewayHttpResult } from "./types";

const MCP_PROTOCOL_VERSION = "2025-03-26";

const jsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: jsonRpcIdSchema.optional(),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
});

const callToolParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
  _meta: z
    .object({
      bypassCache: z.boolean().optional(),
    })
    .optional(),
});

const searchToolsArgsSchema = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(50).default(10),
});

const describeToolArgsSchema = z.object({
  slug: z.string().min(1),
});

const executeRouterToolArgsSchema = z.object({
  slug: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
  bypassCache: z.boolean().default(false),
});

const ROUTER_META_TOOLS = [
  {
    name: "mux__search_tools",
    description: "Search available tools on this endpoint by keyword.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords to match against tool slugs and descriptions.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "mux__describe_tool",
    description: "Inspect the full JSON Schema and metadata for a specific tool slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Canonical tool slug returned by mux__search_tools.",
        },
      },
      required: ["slug"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "mux__execute_tool",
    description: "Execute any enabled tool on this endpoint by slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        arguments: { type: "object" },
        bypassCache: { type: "boolean", default: false },
      },
      required: ["slug"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
];

const extractRawId = (rawBody: unknown): JsonRpcId => {
  if (typeof rawBody === "object" && rawBody !== null && "id" in rawBody) {
    const parsed = jsonRpcIdSchema.safeParse(rawBody.id);

    if (parsed.success) {
      return parsed.data;
    }
  }

  return null;
};

const okResponse = (id: JsonRpcId, result: unknown): McpGatewayHttpResult => ({
  status: 200,
  body: {
    jsonrpc: "2.0",
    id,
    result,
  },
});

const errorResponse = (id: JsonRpcId, code: number, message: string): McpGatewayHttpResult => ({
  status: 200,
  body: {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  },
});

const formatDirectTools = (tools: CanonicalTool[]) =>
  tools.map((tool) => ({
    name: tool.slug,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));

const searchTools = (tools: CanonicalTool[], query: string, limit: number) => {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const matches: Array<{
    slug: string;
    description: string;
    sourceKind: string;
    readOnly: boolean;
    cacheMode: string;
  }> = [];

  for (const tool of tools) {
    const haystack = `${tool.slug} ${tool.name} ${tool.description}`.toLowerCase();
    const matched = tokens.every((token) => haystack.includes(token));

    if (matched) {
      matches.push({
        slug: tool.slug,
        description: tool.description,
        sourceKind: tool.sourceKind,
        readOnly: tool.annotations.readOnlyHint,
        cacheMode: tool.cachePolicy.mode,
      });
    }

    if (matches.length >= limit) {
      break;
    }
  }

  return matches;
};

const safeExecuteTool = async (
  id: JsonRpcId,
  context: McpGatewayContext,
  input: { toolSlug: string; args: Record<string, unknown>; bypassCache: boolean },
): Promise<McpGatewayHttpResult> => {
  try {
    const outcome = await context.executeTool(input);

    return okResponse(id, {
      ...outcome.result,
      _meta: {
        cacheStatus: outcome.cacheStatus,
        durationMs: outcome.durationMs,
      },
    });
  } catch {
    return errorResponse(id, -32603, "Internal tool execution error.");
  }
};

const handleRouterMetaCall = async (
  id: JsonRpcId,
  toolName: string,
  rawArgs: Record<string, unknown>,
  metaBypassCache: boolean,
  context: McpGatewayContext,
): Promise<McpGatewayHttpResult> => {
  if (toolName === "mux__search_tools") {
    const parsed = searchToolsArgsSchema.safeParse(rawArgs);

    if (!parsed.success) {
      return errorResponse(id, -32602, "Invalid arguments for mux__search_tools.");
    }

    const matches = searchTools(context.tools, parsed.data.query, parsed.data.limit);

    return okResponse(id, {
      content: [{ type: "text", text: JSON.stringify({ tools: matches }) }],
      structuredContent: { tools: matches },
    });
  }

  if (toolName === "mux__describe_tool") {
    const parsed = describeToolArgsSchema.safeParse(rawArgs);

    if (!parsed.success) {
      return errorResponse(id, -32602, "Invalid arguments for mux__describe_tool.");
    }

    const tool = context.tools.find((item) => item.slug === parsed.data.slug);

    if (!tool) {
      return okResponse(id, {
        content: [{ type: "text", text: `Tool '${parsed.data.slug}' not found on this endpoint.` }],
        isError: true,
      });
    }

    const detail = {
      slug: tool.slug,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      cachePolicy: tool.cachePolicy,
    };

    return okResponse(id, {
      content: [{ type: "text", text: JSON.stringify(detail) }],
      structuredContent: detail,
    });
  }

  if (toolName === "mux__execute_tool") {
    const parsed = executeRouterToolArgsSchema.safeParse(rawArgs);

    if (!parsed.success) {
      return errorResponse(id, -32602, "Invalid arguments for mux__execute_tool.");
    }

    return safeExecuteTool(id, context, {
      toolSlug: parsed.data.slug,
      args: parsed.data.arguments,
      bypassCache: parsed.data.bypassCache || metaBypassCache,
    });
  }

  return errorResponse(id, -32602, `Unknown router tool '${toolName}'.`);
};

export const handleMcpJsonRpcRequest = async (
  rawBody: unknown,
  context: McpGatewayContext,
): Promise<McpGatewayHttpResult> => {
  const parsed = jsonRpcRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    return errorResponse(extractRawId(rawBody), -32600, "Invalid JSON-RPC 2.0 request.");
  }

  const request = parsed.data;

  if (request.id === undefined) {
    return { status: 202, body: null };
  }

  const id: JsonRpcId = request.id;

  if (request.method === "initialize") {
    return okResponse(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: `mux-${context.endpointSlug}`,
        version: "0.1.0",
      },
    });
  }

  if (request.method === "ping") {
    return okResponse(id, {});
  }

  if (request.method === "tools/list") {
    const tools = context.mode === "router" ? ROUTER_META_TOOLS : formatDirectTools(context.tools);

    return okResponse(id, { tools });
  }

  if (request.method === "tools/call") {
    const callParams = callToolParamsSchema.safeParse(request.params ?? {});

    if (!callParams.success) {
      return errorResponse(id, -32602, "Invalid tools/call parameters.");
    }

    const args = callParams.data.arguments ?? {};
    const metaBypass = callParams.data._meta?.bypassCache ?? false;

    if (context.mode === "router") {
      return handleRouterMetaCall(id, callParams.data.name, args, metaBypass, context);
    }

    return safeExecuteTool(id, context, {
      toolSlug: callParams.data.name,
      args,
      bypassCache: metaBypass,
    });
  }

  return errorResponse(id, -32601, `Method '${request.method}' not found.`);
};

export type { JsonRpcResponse };
