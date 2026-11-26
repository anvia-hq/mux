import { describe, expect, test } from "bun:test";
import { assertSafeUpstreamUrl, createUpstreamMcpClient } from "./upstream-client";

describe("assertSafeUpstreamUrl", () => {
  test("accepts http/https URLs and blocks credentials, metadata hosts, link-local ranges, and IPv6-mapped SSRF", () => {
    expect(assertSafeUpstreamUrl("https://mcp.example.com/sse").hostname).toBe("mcp.example.com");
    expect(assertSafeUpstreamUrl("http://localhost:3001/mcp").hostname).toBe("localhost");

    const blocked = [
      "file:///etc/passwd",
      "ftp://example.com/mcp",
      "http://user:pass@example.com/mcp",
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.169.253/latest/",
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[fe80::1]/mcp",
      "http://[fd00:ec2::254]/latest/",
      "http://100.100.100.200/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://metadata.google.internal./computeMetadata/v1/",
      "not-a-url",
    ];

    for (const url of blocked) {
      expect(() => assertSafeUpstreamUrl(url)).toThrow();
    }
  });
});

describe("createUpstreamMcpClient", () => {
  test("propagates sessions, sends notifications/initialized, sets redirect:error, handles SSE notifications, and calls tools", async () => {
    const seenMethods: string[] = [];
    const seenSessionIds: Array<string | null> = [];
    const seenRedirects: Array<RequestRedirect | undefined> = [];
    const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);

      seenSessionIds.push(headers.get("mcp-session-id"));
      seenRedirects.push(init?.redirect);

      const body = JSON.parse(String(init?.body)) as {
        id?: number;
        method: string;
        params?: { cursor?: string; name?: string; arguments?: Record<string, unknown> };
      };

      seenMethods.push(body.method);

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

      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
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

        const ssePayload = [
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}`,
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "get_repo", description: "Get repo" }] } })}`,
        ].join("\n\n");

        return new Response(`${ssePayload}\n\n`, {
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
    expect(seenMethods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/list",
    ]);
    expect(seenSessionIds).toEqual([null, "sess-123", "sess-123", "sess-123"]);
    expect(seenRedirects.every((mode) => mode === "error")).toBe(true);

    const callResult = await client.callTool(target, "list_issues", { repo: "mux" });

    expect(callResult.content).toEqual([{ type: "text", text: "called:list_issues" }]);
  });

  test("rejects reserved headers, sse transport, cyclic/overflow pagination, SSE notification-only streams, and oversized responses", async () => {
    const client = createUpstreamMcpClient({
      fetchImpl: async () => Response.json({ jsonrpc: "2.0", id: 1, result: {} }),
    });

    await expect(
      client.listTools({
        url: "https://mcp.example.com",
        transport: "sse",
      }),
    ).rejects.toThrow("not supported");

    await expect(
      client.listTools({
        url: "https://mcp.example.com",
        transport: "streamable_http",
        headers: { Host: "evil.internal" },
      }),
    ).rejects.toThrow("reserved");

    let pageCounter = 0;
    const overflowClient = createUpstreamMcpClient({
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id?: number; method: string };

        if (body.method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id: body.id, result: {} });
        }

        if (body.method === "notifications/initialized") {
          return new Response(null, { status: 202 });
        }

        pageCounter += 1;

        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [], nextCursor: `cursor-${pageCounter}` },
        });
      },
    });

    await expect(
      overflowClient.listTools({ url: "https://mcp.example.com", transport: "streamable_http" }),
    ).rejects.toThrow("maximum pagination limit");

    const notifOnlyClient = createUpstreamMcpClient({
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id?: number; method: string };

        if (body.method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id: body.id, result: {} });
        }

        if (body.method === "notifications/initialized") {
          return new Response(null, { status: 202 });
        }

        return new Response(
          `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    await expect(
      notifOnlyClient.listTools({ url: "https://mcp.example.com", transport: "streamable_http" }),
    ).rejects.toThrow("matching JSON-RPC response");

    const boundedClient = createUpstreamMcpClient({
      fetchImpl: async () =>
        new Response("x".repeat(500), { headers: { "content-type": "application/json" } }),
      maxResponseBytes: 100,
    });

    await expect(
      boundedClient.listTools({ url: "https://mcp.example.com", transport: "streamable_http" }),
    ).rejects.toThrow("exceeded");
  });
});
