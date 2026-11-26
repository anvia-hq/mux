import { describe, expect, test } from "bun:test";
import { createTestHarness } from "./testing/test-app";

describe("MCP registry, catalog sync, unified /mcp/:slug gateway, caching, and audit log", () => {
  test("registers an MCP server with encrypted headers, syncs tools, caches execution results, and redacts audit logs", async () => {
    let upstreamCalls = 0;
    const seenHeaders: Array<Record<string, string> | undefined> = [];
    const harness = createTestHarness({
      upstreamMcp: {
        listTools: async (target) => {
          seenHeaders.push(target.headers);

          return [
            {
              name: "list_issues",
              description: "List repository issues",
              inputSchema: {
                type: "object",
                required: ["repo"],
                properties: {
                  repo: { type: "string" },
                  apiToken: { type: "string" },
                },
              },
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
              },
            },
          ];
        },
        callTool: async (target, toolName, args) => {
          upstreamCalls += 1;
          seenHeaders.push(target.headers);

          return {
            content: [
              {
                type: "text",
                text: `${toolName}:${String(args.repo)}:call-${upstreamCalls}`,
              },
            ],
          };
        },
      },
    });

    const admin = harness.seedUser({
      id: "admin-gw",
      email: "admin@mux.dev",
      name: "Admin",
      role: "admin",
    });
    const member = harness.seedUser({
      id: "member-gw",
      email: "member@mux.dev",
      name: "Member",
      role: "member",
    });

    const memberCreateAttempt = await harness.request("/v1/sources/mcp", {
      method: "POST",
      userId: member.id,
      body: {
        slug: "github",
        name: "GitHub MCP",
        url: "https://mcp.github.example/mcp",
      },
    });

    expect(memberCreateAttempt.status).toBe(403);

    const createSourceRes = await harness.request("/v1/sources/mcp", {
      method: "POST",
      userId: admin.id,
      body: {
        slug: "github",
        name: "GitHub MCP",
        url: "https://mcp.github.example/mcp",
        headers: { Authorization: "Bearer gh-secret-token" },
      },
    });

    expect(createSourceRes.status).toBe(201);

    const createSourceData = await createSourceRes.json();

    expect(createSourceData.syncedToolsCount).toBe(1);
    expect(createSourceData.syncError).toBeNull();
    expect(createSourceData.source.hasSecrets).toBe(true);
    expect("encryptedSecrets" in createSourceData.source).toBe(false);
    expect(seenHeaders[0]).toEqual({ Authorization: "Bearer gh-secret-token" });

    const toolsRes = await harness.request(`/v1/tools?sourceId=${createSourceData.source.id}`, {
      userId: member.id,
    });
    const syncedTools = (await toolsRes.json()).tools;

    expect(syncedTools.length).toBe(1);

    const issueTool = syncedTools[0];

    expect(issueTool.slug).toBe("github__list_issues");

    const updatePolicyRes = await harness.request(`/v1/tools/${issueTool.id}`, {
      method: "PATCH",
      userId: admin.id,
      body: {
        cachePolicy: { mode: "ttl", ttlSeconds: 120, tags: ["github:issues"] },
      },
    });

    expect(updatePolicyRes.status).toBe(200);

    const epRes = await harness.request("/v1/endpoints", {
      method: "POST",
      userId: admin.id,
      body: { slug: "dev-agent", name: "Dev Agent", mode: "direct" },
    });
    const endpoint = (await epRes.json()).endpoint;

    const routerEpRes = await harness.request("/v1/endpoints", {
      method: "POST",
      userId: admin.id,
      body: { slug: "router-agent", name: "Router Agent", mode: "router" },
    });
    const routerEndpoint = (await routerEpRes.json()).endpoint;

    await harness.request(`/v1/endpoints/${endpoint.id}/tools/${issueTool.id}`, {
      method: "PUT",
      userId: admin.id,
      body: { enabled: true },
    });
    await harness.request(`/v1/endpoints/${routerEndpoint.id}/tools/${issueTool.id}`, {
      method: "PUT",
      userId: admin.id,
      body: { enabled: true },
    });

    const keyRes = await harness.request("/v1/api-keys", {
      method: "POST",
      userId: admin.id,
      body: { name: "Dev Key", endpointId: endpoint.id },
    });
    const scopedKey = (await keyRes.json()).rawKey as string;

    const globalKeyRes = await harness.request("/v1/api-keys", {
      method: "POST",
      userId: admin.id,
      body: { name: "Global Key" },
    });
    const globalKey = (await globalKeyRes.json()).rawKey as string;

    expect(
      (
        await harness.request("/mcp/dev-agent", {
          method: "POST",
          body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        })
      ).status,
    ).toBe(401);

    expect(
      (
        await harness.request("/mcp/router-agent", {
          method: "POST",
          bearerToken: scopedKey,
          body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        })
      ).status,
    ).toBe(403);

    const mcpListRes = await harness.request("/mcp/dev-agent", {
      method: "POST",
      bearerToken: scopedKey,
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });

    expect(mcpListRes.status).toBe(200);
    expect((await mcpListRes.json()).result.tools[0].name).toBe("github__list_issues");

    const firstCallRes = await harness.request("/mcp/dev-agent", {
      method: "POST",
      bearerToken: scopedKey,
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "github__list_issues",
          arguments: { repo: "anvia/mux", apiToken: "super-secret-value" },
        },
      },
    });
    const firstCall = await firstCallRes.json();

    expect(firstCall.result._meta.cacheStatus).toBe("miss");
    expect(firstCall.result.content[0].text).toBe("list_issues:anvia/mux:call-1");
    expect(upstreamCalls).toBe(1);

    const secondCallRes = await harness.request("/mcp/dev-agent", {
      method: "POST",
      bearerToken: scopedKey,
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "github__list_issues",
          arguments: { apiToken: "super-secret-value", repo: "anvia/mux" },
        },
      },
    });
    const secondCall = await secondCallRes.json();

    expect(secondCall.result._meta.cacheStatus).toBe("hit");
    expect(secondCall.result.content[0].text).toBe("list_issues:anvia/mux:call-1");
    expect(upstreamCalls).toBe(1);

    const invalidArgsRes = await harness.request("/mcp/dev-agent", {
      method: "POST",
      bearerToken: scopedKey,
      body: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "github__list_issues",
          arguments: {},
        },
      },
    });

    expect((await invalidArgsRes.json()).result.isError).toBe(true);

    const routerCallRes = await harness.request("/mcp/router-agent", {
      method: "POST",
      bearerToken: globalKey,
      body: {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "mux__execute_tool",
          arguments: {
            slug: "github__list_issues",
            arguments: { repo: "anvia/mux" },
          },
        },
      },
    });
    const routerCall = await routerCallRes.json();

    expect(routerCall.result._meta.cacheStatus).toBe("miss");
    expect(upstreamCalls).toBe(2);

    const playgroundRes = await harness.request(`/v1/tools/${issueTool.id}/execute`, {
      method: "POST",
      userId: member.id,
      body: { arguments: { repo: "playground/repo" } },
    });

    expect(playgroundRes.status).toBe(200);
    expect((await playgroundRes.json()).cacheStatus).toBe("miss");

    const logsRes = await harness.request("/v1/executions?limit=10", { userId: member.id });
    const logs = (await logsRes.json()).executions;

    expect(logs.length).toBe(4);

    const serializedLogs = JSON.stringify(logs);

    expect(serializedLogs).not.toContain("super-secret-value");
    expect(serializedLogs).toContain("[redacted]");

    const purgeTagRes = await harness.request("/v1/tools/cache/invalidate-tag", {
      method: "POST",
      userId: admin.id,
      body: { tag: "github:issues" },
    });

    expect(purgeTagRes.status).toBe(200);
    expect((await purgeTagRes.json()).deleted).toBeGreaterThanOrEqual(1);
  });
});
