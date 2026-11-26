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
    inputSchema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    cachePolicy: { mode: "ttl", ttlSeconds: 300, allowBypass: true },
    schemaHash: "hash2",
    enabled: true,
  },
];

describe("handleMcpJsonRpcRequest", () => {
  test("handles initialize, notifications, ping, direct tools/list, and direct tools/call", async () => {
    const executed: Array<{
      toolSlug: string;
      args: Record<string, unknown>;
      bypassCache: boolean;
    }> = [];
    const context = {
      endpointSlug: "support",
      mode: "direct" as const,
      tools: sampleTools,
      executeTool: async (input: {
        toolSlug: string;
        args: Record<string, unknown>;
        bypassCache: boolean;
      }) => {
        executed.push(input);

        return {
          result: { content: [{ type: "text" as const, text: "done" }] },
          cacheStatus: "hit" as const,
          durationMs: 2,
        };
      },
    };

    const init = await handleMcpJsonRpcRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      context,
    );

    expect(init.status).toBe(200);
    expect(init.body && "result" in init.body).toBe(true);

    const notif = await handleMcpJsonRpcRequest(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      context,
    );

    expect(notif).toEqual({ status: 202, body: null });

    const listed = await handleMcpJsonRpcRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      context,
    );

    expect(listed.body && "result" in listed.body).toBe(true);

    const listResult = (listed.body as { result: { tools: Array<{ name: string }> } }).result;

    expect(listResult.tools.map((t) => t.name)).toEqual([
      "github__list_issues",
      "stripe__get_customer",
    ]);

    const called = await handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "github__list_issues",
          arguments: { repo: "mux" },
          _meta: { bypassCache: true },
        },
      },
      context,
    );

    expect(executed).toEqual([
      { toolSlug: "github__list_issues", args: { repo: "mux" }, bypassCache: true },
    ]);
    expect(
      (called.body as { result: { _meta: { cacheStatus: string } } }).result._meta.cacheStatus,
    ).toBe("hit");
  });

  test("exposes router meta-tools and dispatches search, describe, and execute in router mode", async () => {
    const executed: string[] = [];
    const context = {
      endpointSlug: "all-tools",
      mode: "router" as const,
      tools: sampleTools,
      executeTool: async (input: {
        toolSlug: string;
        args: Record<string, unknown>;
        bypassCache: boolean;
      }) => {
        executed.push(input.toolSlug);

        return {
          result: { content: [{ type: "text" as const, text: "customer-1" }] },
          cacheStatus: "miss" as const,
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

    const searched = await handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "mux__search_tools", arguments: { query: "stripe email" } },
      },
      context,
    );
    const searchOut = (
      searched.body as { result: { structuredContent: { tools: Array<{ slug: string }> } } }
    ).result.structuredContent;

    expect(searchOut.tools.map((t) => t.slug)).toEqual(["stripe__get_customer"]);

    const described = await handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "mux__describe_tool", arguments: { slug: "stripe__get_customer" } },
      },
      context,
    );
    const describeOut = (described.body as { result: { structuredContent: { slug: string } } })
      .result.structuredContent;

    expect(describeOut.slug).toBe("stripe__get_customer");

    const execRes = await handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "mux__execute_tool",
          arguments: { slug: "stripe__get_customer", arguments: { email: "a@b.c" } },
        },
      },
      context,
    );

    expect(executed).toEqual(["stripe__get_customer"]);
    expect(execRes.status).toBe(200);

    const unknownMethod = await handleMcpJsonRpcRequest(
      { jsonrpc: "2.0", id: 5, method: "resources/list" },
      context,
    );

    expect((unknownMethod.body as { error: { code: number } }).error.code).toBe(-32601);
  });
});
