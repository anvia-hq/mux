import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createTestHarness } from "./testing/test-app";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("Code plugin sources (local + uploaded) over unified /mcp/:slug gateway", () => {
  test("discovers and registers local plugin, uploads custom plugin with encrypted secrets, caches over MCP gateway, and cleans up on delete", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mux-api-plugins-"));

    tempDirs.push(tempRoot);

    const uploadedRoot = join(tempRoot, "uploaded");

    await mkdir(uploadedRoot, { recursive: true });

    const repoPluginsDir = resolve(import.meta.dir, "../../../plugins");
    const harness = createTestHarness({
      localPluginsRoot: repoPluginsDir,
      uploadedPluginsRoot: uploadedRoot,
    });
    const admin = harness.seedUser({
      id: "admin-plg",
      email: "admin@mux.dev",
      name: "Admin",
      role: "admin",
    });
    const member = harness.seedUser({
      id: "member-plg",
      email: "member@mux.dev",
      name: "Member",
      role: "member",
    });

    expect((await harness.request("/v1/sources/plugins/local", { userId: member.id })).status).toBe(
      403,
    );

    const localListRes = await harness.request("/v1/sources/plugins/local", { userId: admin.id });

    expect(localListRes.status).toBe(200);

    const localPlugins = (await localListRes.json()).plugins as Array<{ directoryName: string }>;

    expect(localPlugins.some((p) => p.directoryName === "example-utils")).toBe(true);

    const registerLocalRes = await harness.request("/v1/sources/plugins/local", {
      method: "POST",
      userId: admin.id,
      body: { directoryName: "example-utils" },
    });

    expect(registerLocalRes.status).toBe(201);

    const localSource = (await registerLocalRes.json()).source;
    const uploadRes = await harness.request("/v1/sources/plugins/upload", {
      method: "POST",
      userId: admin.id,
      body: {
        manifest: {
          name: "greeter",
          version: "1.0.0",
          description: "Custom uploaded greeting plugin",
          entry: "./index.ts",
          secrets: ["GREETING_PREFIX"],
          timeoutMs: 5000,
          tools: [
            {
              name: "greet",
              description: "Greet a user with configured secret prefix",
              handler: "greetUser",
              readOnly: true,
              inputSchema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" } },
              },
              cache: { mode: "ttl", ttlSeconds: 120 },
            },
          ],
        },
        files: [
          {
            path: "index.ts",
            content:
              'export const greetUser = ({ name }, ctx) => ({ message: `${ctx.env.GREETING_PREFIX ?? "Hi"} ${name}` });',
          },
        ],
        secrets: { GREETING_PREFIX: "Hello" },
      },
    });

    expect(uploadRes.status).toBe(201);

    const uploadedData = await uploadRes.json();

    expect(uploadedData.syncedToolsCount).toBe(1);
    expect(uploadedData.source.hasSecrets).toBe(true);

    const allTools = (await (await harness.request("/v1/tools", { userId: admin.id })).json())
      .tools as Array<{ id: string; slug: string }>;
    const slugifyTool = allTools.find((t) => t.slug === "example-utils__slugify");
    const greetTool = allTools.find((t) => t.slug === "greeter__greet");

    expect(slugifyTool).toBeDefined();
    expect(greetTool).toBeDefined();

    const ep = (
      await (
        await harness.request("/v1/endpoints", {
          method: "POST",
          userId: admin.id,
          body: { slug: "plugins-ep", name: "Plugins Endpoint" },
        })
      ).json()
    ).endpoint;

    await harness.request(`/v1/endpoints/${ep.id}/tools/${slugifyTool?.id}`, {
      method: "PUT",
      userId: admin.id,
      body: { enabled: true },
    });
    await harness.request(`/v1/endpoints/${ep.id}/tools/${greetTool?.id}`, {
      method: "PUT",
      userId: admin.id,
      body: { enabled: true },
    });

    const apiKey = (
      await (
        await harness.request("/v1/api-keys", {
          method: "POST",
          userId: admin.id,
          body: { name: "Plugins Key", endpointId: ep.id },
        })
      ).json()
    ).rawKey as string;

    const slugCall = await (
      await harness.request("/mcp/plugins-ep", {
        method: "POST",
        bearerToken: apiKey,
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "example-utils__slugify",
            arguments: { text: "Hello Composio World!" },
          },
        },
      })
    ).json();

    expect(slugCall.result.structuredContent).toEqual({ slug: "hello-composio-world" });
    expect(slugCall.result._meta.cacheStatus).toBe("miss");

    const greetFirst = await (
      await harness.request("/mcp/plugins-ep", {
        method: "POST",
        bearerToken: apiKey,
        body: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "greeter__greet", arguments: { name: "Indra" } },
        },
      })
    ).json();

    expect(greetFirst.result.structuredContent).toEqual({ message: "Hello Indra" });
    expect(greetFirst.result._meta.cacheStatus).toBe("miss");

    const greetCached = await (
      await harness.request("/mcp/plugins-ep", {
        method: "POST",
        bearerToken: apiKey,
        body: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "greeter__greet", arguments: { name: "Indra" } },
        },
      })
    ).json();

    expect(greetCached.result._meta.cacheStatus).toBe("hit");

    await harness.request(`/v1/sources/${uploadedData.source.id}`, {
      method: "PATCH",
      userId: admin.id,
      body: { secrets: { GREETING_PREFIX: "Welcome" } },
    });

    const greetAfterRotate = await (
      await harness.request("/mcp/plugins-ep", {
        method: "POST",
        bearerToken: apiKey,
        body: {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "greeter__greet", arguments: { name: "Indra" } },
        },
      })
    ).json();

    expect(greetAfterRotate.result.structuredContent).toEqual({ message: "Welcome Indra" });
    expect(greetAfterRotate.result._meta.cacheStatus).toBe("miss");

    const resyncLocal = await harness.request(`/v1/sources/${localSource.id}/sync`, {
      method: "POST",
      userId: admin.id,
    });

    expect(resyncLocal.status).toBe(200);

    const deleteUploaded = await harness.request(`/v1/sources/${uploadedData.source.id}`, {
      method: "DELETE",
      userId: admin.id,
    });

    expect(deleteUploaded.status).toBe(204);
    await expect(stat(join(uploadedRoot, "greeter"))).rejects.toThrow();
  });
});
