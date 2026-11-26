import { describe, expect, test } from "bun:test";
import { assertSafeUpstreamUrl, createUpstreamMcpClient } from "./upstream-client";

describe("assertSafeUpstreamUrl", () => {
  test("accepts http/https URLs and blocks non-HTTP schemes and cloud metadata hosts", () => {
    expect(assertSafeUpstreamUrl("https://mcp.example.com/sse").hostname).toBe("mcp.example.com");
    expect(assertSafeUpstreamUrl("http://localhost:3001/mcp").hostname).toBe("localhost");

    const blocked = [
      "file:///etc/passwd",
      "ftp://example.com/mcp",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "not-a-url",
    ];

    for (const url of blocked) {
      expect(() => assertSafeUpstreamUrl(url)).toThrow();
    }
  });
});

describe("createUpstreamMcpClient", () => {
  test("handles initialize session propagation, cursor pagination, SSE responses, and tool calls", async () => {
    const seenSessionIds: Array<string | null> = [];
    const seenAuthHeaders: Array<string | null> = [];
    const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);

      seenSessionIds.push(headers.get("mcp-session-id"));
      seenAuthHeaders.push(headers.get("authorization"));

      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params?: { cursor?: string; name?: string; arguments?: Record<string, unknown> };
      };

      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2025-03-26" },
          }),
          {
            headers: {
              "content-type": "application/json",
              "mcp-session-id": "sess-123",
            },
          },
        );
      }

      if (body.method === "tools/list") {
        if (!body.params?.cursor) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                tools: [
                  {
                    name: "list_issues",
                    description: "List GitHub issues",
                    inputSchema: { type: "object", properties: { repo: { type: "string" } } },
                    annotations: { readOnlyHint: true },
                  },
                ],
                nextCursor: "page-2",
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }

        const ssePayload = `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [{ name: "get_repo", description: "Get repository info" }],
          },
        })}\n\n`;

        return new Response(ssePayload, {
          headers: { "content-type": "text/event-stream" },
        });
      }

      if (body.method === "tools/call") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: `called:${body.params?.name}` }],
              structuredContent: { ok: true },
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      return new Response("not found", { status: 404 });
    };

    const client = createUpstreamMcpClient({ fetchImpl: fakeFetch });
    const target = {
      url: "https://mcp.example.com/mcp",
      transport: "streamable_http" as const,
      headers: { Authorization: "Bearer upstream-secret" },
    };

    const tools = await client.listTools(target);

    expect(tools.length).toBe(2);
    expect(tools[0].annotations.readOnlyHint).toBe(true);
    expect(tools[1].inputSchema).toEqual({ type: "object", properties: {} });
    expect(seenSessionIds).toEqual([null, "sess-123", "sess-123"]);
    expect(seenAuthHeaders.every((h) => h === "Bearer upstream-secret")).toBe(true);

    const callResult = await client.callTool(target, "list_issues", { repo: "mux" });

    expect(callResult.content).toEqual([{ type: "text", text: "called:list_issues" }]);
    expect(callResult.structuredContent).toEqual({ ok: true });
  });

  test("rejects cyclic pagination cursors and oversized responses", async () => {
    const cyclicFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string };

      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: {} });
      }

      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [], nextCursor: "same-cursor" },
      });
    };

    const cyclicClient = createUpstreamMcpClient({ fetchImpl: cyclicFetch });

    await expect(
      cyclicClient.listTools({ url: "https://mcp.example.com", transport: "streamable_http" }),
    ).rejects.toThrow("cyclic");

    const hugeFetch = async () =>
      new Response("x".repeat(500), {
        headers: { "content-type": "application/json" },
      });
    const boundedClient = createUpstreamMcpClient({ fetchImpl: hugeFetch, maxResponseBytes: 100 });

    await expect(
      boundedClient.listTools({ url: "https://mcp.example.com", transport: "streamable_http" }),
    ).rejects.toThrow("exceeded");
  });
});
