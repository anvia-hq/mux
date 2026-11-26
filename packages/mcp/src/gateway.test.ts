import { describe, expect, test } from "bun:test";
import type { CanonicalTool } from "@mux/core/types";
import { handleMcpJsonRpcRequest } from "./gateway";

const sampleTools: CanonicalTool[] = [
  {
    id: "t1",
    sourceId: "s1",
    sourceSlug: "github",
    sourceKind: "mcp_remote",
    name: "list_issues",
    slug: "github__list_issues",
    description: "List GitHub issues in a repository",
    inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    cachePolicy: { mode: "ttl", ttlSeconds: 60, allowBypass: true },
    schemaHash: "hash1",
    enabled: true,
  },
  {
    id: "t2",
    sourceId: "s2",
    sourceSlug: "stripe",
    sourceKind: "plugin_code",
    name: "get_customer",
    slug: "stripe__get_customer",
    description: "Lookup Stripe customer by email",
    inputSchema: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    cachePolicy: { mode: "ttl", ttlSeconds: 300, allowBypass: true },
    schemaHash: "hash2",
    enabled: true,
  },
];

describe("handleMcpJsonRpcRequest", () => {
  test("handles initialize, params:null, notifications, preserved invalid-request ids, and -32603 errors", async () => {
    const context = {
      endpointSlug: "support",
      mode: "direct" as const,
      tools: sampleTools,
      executeTool: async () => {
        throw new Error("unexpected runtime crash");
      },
    };

    const init = await handleMcpJsonRpcRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: null },
      context,
    );
    const initResult = (
      init.body as { result: { capabilities: { tools: { listChanged: boolean } } } }
    ).result;

    expect(initResult.capabilities.tools.listChanged).toBe(false);

    const pingWithNullParams = await handleMcpJsonRpcRequest(
      { jsonrpc: "2.0", id: "ping-1", method: "ping", params: null },
      context,
    );

    expect(pingWithNullParams.body).toEqual({ jsonrpc: "2.0", id: "ping-1", result: {} });

    const invalidReq = await handleMcpJsonRpcRequest({ jsonrpc: "1.0", id: 99 }, context);

    expect(invalidReq.body).toEqual({
      jsonrpc: "2.0",
      id: 99,
      error: { code: -32600, message: "Invalid JSON-RPC 2.0 request." },
    });

    const notif = await handleMcpJsonRpcRequest(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      context,
    );

    expect(notif).toEqual({ status: 202, body: null });

    const crashedCall = await handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "github__list_issues", arguments: {} },
      },
      context,
    );

    expect((crashedCall.body as { error: { code: number } }).error.code).toBe(-32603);
  });

  test("exposes router meta-tools, supports empty search query, and forwards _meta.bypassCache", async () => {
    const executed: Array<{ toolSlug: string; bypassCache: boolean }> = [];
    const context = {
      endpointSlug: "all-tools",
      mode: "router" as const,
      tools: sampleTools,
      executeTool: async (input: {
        toolSlug: string;
        args: Record<string, unknown>;
        bypassCache: boolean;
      }) => {
        executed.push({ toolSlug: input.toolSlug, bypassCache: input.bypassCache });

        return {
          result: { content: [{ type: "text" as const, text: "customer-1" }] },
          cacheStatus: "bypass" as const,
          durationMs: 12,
        };
      },
    };

    const listed = await handleMcpJsonRpcRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      context,
    );
    const metaNames = (
      listed.body as { result: { tools: Array<{ name: string }> } }
    ).result.tools.map((t) => t.name);

    expect(metaNames).toEqual(["mux__search_tools", "mux__describe_tool", "mux__execute_tool"]);

    const searchAll = await handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "mux__search_tools", arguments: {} },
      },
      context,
    );
    const allOut = (
      searchAll.body as { result: { structuredContent: { tools: Array<{ slug: string }> } } }
    ).result.structuredContent;

    expect(allOut.tools.length).toBe(2);

    const execRes = await handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "mux__execute_tool",
          arguments: { slug: "stripe__get_customer", arguments: { email: "a@b.c" } },
          _meta: { bypassCache: true },
        },
      },
      context,
    );

    expect(executed).toEqual([{ toolSlug: "stripe__get_customer", bypassCache: true }]);
    expect(execRes.status).toBe(200);

    const unknownMethod = await handleMcpJsonRpcRequest(
      { jsonrpc: "2.0", id: 5, method: "resources/list" },
      context,
    );

    expect((unknownMethod.body as { error: { code: number } }).error.code).toBe(-32601);
  });
});
