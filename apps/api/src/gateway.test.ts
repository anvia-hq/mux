import { describe, expect, test } from "bun:test";
import { createTestHarness } from "./testing/test-app";

describe("MCP registry, catalog sync, unified /mcp/:slug gateway, caching, and audit log", () => {
  test("registers an MCP server, syncs tools, prevents endpoint enumeration, caches results, and scopes audit logs", async () => {
    let upstreamCalls = 0;
    let shouldFailUpstreamCall = false;
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

          if (shouldFailUpstreamCall) {
            throw new Error("internal upstream error https://10.0.0.5:9000/secret");
          }

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

    expect(
      (
        await harness.request("/v1/sources/mcp", {
          method: "POST",
          userId: member.id,
          body: { slug: "github", name: "GitHub", url: "https://mcp.github.example/mcp" },
        })
      ).status,
    ).toBe(403);

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
    expect(createSourceData.source.hasSecrets).toBe(true);
    expect("encryptedSecrets" in createSourceData.source).toBe(false);
    expect(seenHeaders[0]).toEqual({ Authorization: "Bearer gh-secret-token" });

    const issueTool = (
      await (
        await harness.request(`/v1/tools?sourceId=${createSourceData.source.id}`, {
          userId: member.id,
        })
      ).json()
    ).tools[0];

    await harness.request(`/v1/tools/${issueTool.id}`, {
      method: "PATCH",
      userId: admin.id,
      body: { cachePolicy: { mode: "ttl", ttlSeconds: 120, tags: ["github:issues"] } },
    });

    const endpoint = (
      await (
        await harness.request("/v1/endpoints", {
          method: "POST",
          userId: admin.id,
          body: { slug: "dev-agent", name: "Dev Agent", mode: "direct" },
        })
      ).json()
    ).endpoint;

    const disabledEndpoint = (
      await (
        await harness.request("/v1/endpoints", {
          method: "POST",
          userId: admin.id,
          body: { slug: "disabled-ep", name: "Disabled", enabled: false },
        })
      ).json()
    ).endpoint;

    await harness.request(`/v1/endpoints/${endpoint.id}/tools/${issueTool.id}`, {
      method: "PUT",
      userId: admin.id,
      body: { enabled: true },
    });

    const scopedKey = (
      await (
        await harness.request("/v1/api-keys", {
          method: "POST",
          userId: admin.id,
          body: { name: "Dev Key", endpointId: endpoint.id },
        })
      ).json()
    ).rawKey as string;

    const globalKey = (
      await (
        await harness.request("/v1/api-keys", {
          method: "POST",
          userId: admin.id,
          body: { name: "Global Key" },
        })
      ).json()
    ).rawKey as string;

    expect(
      (
        await harness.request("/mcp/nonexistent-slug", {
          method: "POST",
          bearerToken: "mux_live_invalid",
          body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await harness.request(`/mcp/${disabledEndpoint.slug}`, {
          method: "POST",
          bearerToken: "mux_live_invalid",
          body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await harness.request("/mcp/nonexistent-slug", {
          method: "POST",
          bearerToken: scopedKey,
          body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await harness.request(`/mcp/${disabledEndpoint.slug}`, {
          method: "POST",
          bearerToken: scopedKey,
          body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await harness.request(`/mcp/${disabledEndpoint.slug}`, {
          method: "POST",
          bearerToken: globalKey,
          body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        })
      ).status,
    ).toBe(404);

    const firstCall = await (
      await harness.request("/mcp/dev-agent", {
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
      })
    ).json();

    expect(firstCall.result._meta.cacheStatus).toBe("miss");
    expect(upstreamCalls).toBe(1);

    const restHitRes = await harness.request("/v1/gateway/dev-agent/execute/github__list_issues", {
      method: "POST",
      bearerToken: scopedKey,
      body: {
        arguments: { apiToken: "super-secret-value", repo: "anvia/mux" },
      },
    });

    expect(restHitRes.status).toBe(200);
    expect((await restHitRes.json()).cacheStatus).toBe("hit");
    expect(upstreamCalls).toBe(1);

    await harness.request(`/v1/sources/${createSourceData.source.id}`, {
      method: "PATCH",
      userId: admin.id,
      body: { headers: { Authorization: "Bearer gh-rotated-token" } },
    });

    const afterRotateRes = await harness.request(
      "/v1/gateway/dev-agent/execute/github__list_issues",
      {
        method: "POST",
        bearerToken: scopedKey,
        body: {
          arguments: { repo: "anvia/mux", apiToken: "super-secret-value" },
        },
      },
    );

    expect((await afterRotateRes.json()).cacheStatus).toBe("miss");
    expect(upstreamCalls).toBe(2);
    expect(seenHeaders.at(-1)).toEqual({ Authorization: "Bearer gh-rotated-token" });

    shouldFailUpstreamCall = true;

    const failedRes = await harness.request("/v1/gateway/dev-agent/execute/github__list_issues", {
      method: "POST",
      bearerToken: scopedKey,
      body: {
        arguments: { repo: "anvia/fail-case" },
        bypassCache: true,
      },
    });

    expect(failedRes.status).toBe(503);

    const failedBody = await failedRes.text();

    expect(failedBody).not.toContain("10.0.0.5");

    shouldFailUpstreamCall = false;

    expect(
      (
        await harness.request(`/v1/tools/${issueTool.id}/execute`, {
          method: "POST",
          userId: member.id,
          body: { arguments: { repo: "blocked" } },
        })
      ).status,
    ).toBe(403);

    const adminPlayground = await harness.request(`/v1/tools/${issueTool.id}/execute`, {
      method: "POST",
      userId: admin.id,
      body: { arguments: { repo: "playground/repo" } },
    });

    expect(adminPlayground.status).toBe(200);

    const memberLogs = (
      await (await harness.request("/v1/executions", { userId: member.id })).json()
    ).executions;
    const adminLogs = (await (await harness.request("/v1/executions", { userId: admin.id })).json())
      .executions;

    expect(memberLogs.length).toBe(0);
    expect(adminLogs.length).toBe(5);
    expect(JSON.stringify(adminLogs)).not.toContain("super-secret-value");
    expect(JSON.stringify(adminLogs)).toContain("[redacted]");
  });

  test("preserves stable slugs across reordered re-syncs and preserves disabled status on failed manual sync", async () => {
    let syncStep = 0;
    const harness = createTestHarness({
      upstreamMcp: {
        listTools: async () => {
          syncStep += 1;

          if (syncStep === 1) {
            return [
              {
                name: "foo.bar",
                description: "First",
                inputSchema: { type: "object", properties: {} },
                annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
              },
              {
                name: "foo/bar",
                description: "Second",
                inputSchema: { type: "object", properties: {} },
                annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
              },
              {
                name: "foo.bar",
                description: "Duplicate ignored",
                inputSchema: { type: "object", properties: {} },
                annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
              },
            ];
          }

          if (syncStep === 2) {
            return [
              {
                name: "foo/bar",
                description: "Second reordered",
                inputSchema: { type: "object", properties: {} },
                annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
              },
              {
                name: "foo.bar",
                description: "First reordered",
                inputSchema: { type: "object", properties: {} },
                annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
              },
            ];
          }

          throw new Error("upstream offline");
        },
      },
    });
    const admin = harness.seedUser({
      id: "admin-sync",
      email: "admin@mux.dev",
      name: "Admin",
      role: "admin",
    });

    const created = await (
      await harness.request("/v1/sources/mcp", {
        method: "POST",
        userId: admin.id,
        body: { slug: "acme", name: "Acme", url: "https://acme.example/mcp" },
      })
    ).json();

    expect(created.syncedToolsCount).toBe(2);

    const beforeTools = (
      await (
        await harness.request(`/v1/tools?sourceId=${created.source.id}`, { userId: admin.id })
      ).json()
    ).tools as Array<{ name: string; slug: string }>;
    const beforeSlugs = new Map(beforeTools.map((t) => [t.name, t.slug]));

    const resyncRes = await harness.request(`/v1/sources/${created.source.id}/sync`, {
      method: "POST",
      userId: admin.id,
    });

    expect(resyncRes.status).toBe(200);

    const afterTools = (
      await (
        await harness.request(`/v1/tools?sourceId=${created.source.id}`, { userId: admin.id })
      ).json()
    ).tools as Array<{ name: string; slug: string }>;

    for (const tool of afterTools) {
      expect(beforeSlugs.get(tool.name)).toBe(tool.slug);
    }

    await harness.request(`/v1/sources/${created.source.id}`, {
      method: "PATCH",
      userId: admin.id,
      body: { status: "disabled" },
    });

    const failedSync = await harness.request(`/v1/sources/${created.source.id}/sync`, {
      method: "POST",
      userId: admin.id,
    });

    expect(failedSync.status).toBe(503);

    const sourceAfterFail = (
      await (await harness.request(`/v1/sources/${created.source.id}`, { userId: admin.id })).json()
    ).source;

    expect(sourceAfterFail.status).toBe("disabled");
    expect(sourceAfterFail.lastError).toBe("upstream offline");
  });
});
