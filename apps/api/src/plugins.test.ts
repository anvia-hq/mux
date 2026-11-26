import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
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
  test("enforces admin RBAC, registers local & uploaded plugins, invalidates caches on sync & secret rotation, and cleans up on delete", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mux-api-plugins-"));

    tempDirs.push(tempRoot);

    const localRoot = join(tempRoot, "local");
    const uploadedRoot = join(tempRoot, "uploaded");
    const editableDir = join(localRoot, "editable-plugin");

    await mkdir(editableDir, { recursive: true });
    await mkdir(uploadedRoot, { recursive: true });
    await writeFile(
      join(editableDir, "manifest.json"),
      JSON.stringify({
        name: "editable-plugin",
        version: "1.0.0",
        entry: "./index.ts",
        tools: [
          {
            name: "version",
            description: "Return plugin build tag",
            handler: "getVersion",
            readOnly: true,
            inputSchema: { type: "object", properties: {} },
            cache: { mode: "ttl", ttlSeconds: 300 },
          },
        ],
      }),
    );
    await writeFile(join(editableDir, "index.ts"), "export const getVersion = () => ({ rev: 1 });");

    const harness = createTestHarness({
      localPluginsRoot: localRoot,
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
    expect(
      (
        await harness.request("/v1/sources/plugins/local", {
          method: "POST",
          userId: member.id,
          body: { directoryName: "editable-plugin" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await harness.request("/v1/sources/plugins/upload", {
          method: "POST",
          userId: member.id,
          body: {
            manifest: {
              name: "blocked",
              version: "1.0.0",
              entry: "./index.ts",
              tools: [
                {
                  name: "t",
                  description: "t",
                  handler: "t",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            },
            files: [{ path: "index.ts", content: "export const t = () => ({});" }],
          },
        })
      ).status,
    ).toBe(403);

    const registerLocalRes = await harness.request("/v1/sources/plugins/local", {
      method: "POST",
      userId: admin.id,
      body: { directoryName: "editable-plugin" },
    });

    expect(registerLocalRes.status).toBe(201);

    const localSource = (await registerLocalRes.json()).source;
    const uploadBody = {
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
    };

    const uploadRes = await harness.request("/v1/sources/plugins/upload", {
      method: "POST",
      userId: admin.id,
      body: uploadBody,
    });

    expect(uploadRes.status).toBe(201);

    const uploadedData = await uploadRes.json();

    expect(
      (
        await harness.request("/v1/sources/plugins/upload", {
          method: "POST",
          userId: admin.id,
          body: uploadBody,
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await harness.request(`/v1/sources/${uploadedData.source.id}/sync`, {
          method: "POST",
          userId: admin.id,
        })
      ).status,
    ).toBe(422);

    const allTools = (await (await harness.request("/v1/tools", { userId: admin.id })).json())
      .tools as Array<{ id: string; slug: string }>;
    const versionTool = allTools.find((t) => t.slug === "editable-plugin__version");
    const greetTool = allTools.find((t) => t.slug === "greeter__greet");

    const ep = (
      await (
        await harness.request("/v1/endpoints", {
          method: "POST",
          userId: admin.id,
          body: { slug: "plugins-ep", name: "Plugins Endpoint" },
        })
      ).json()
    ).endpoint;

    await harness.request(`/v1/endpoints/${ep.id}/tools/${versionTool?.id}`, {
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

    const rev1Call = await (
      await harness.request("/mcp/plugins-ep", {
        method: "POST",
        bearerToken: apiKey,
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "editable-plugin__version", arguments: {} },
        },
      })
    ).json();

    expect(rev1Call.result.structuredContent).toEqual({ rev: 1 });
    expect(rev1Call.result._meta.cacheStatus).toBe("miss");

    await writeFile(join(editableDir, "index.ts"), "export const getVersion = () => ({ rev: 2 });");

    const resyncLocal = await harness.request(`/v1/sources/${localSource.id}/sync`, {
      method: "POST",
      userId: admin.id,
    });

    expect(resyncLocal.status).toBe(200);

    const rev2Call = await (
      await harness.request("/mcp/plugins-ep", {
        method: "POST",
        bearerToken: apiKey,
        body: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "editable-plugin__version", arguments: {} },
        },
      })
    ).json();

    expect(rev2Call.result.structuredContent).toEqual({ rev: 2 });
    expect(rev2Call.result._meta.cacheStatus).toBe("miss");

    const greetFirst = await (
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

    expect(greetFirst.result.structuredContent).toEqual({ message: "Hello Indra" });

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

    const deleteUploaded = await harness.request(`/v1/sources/${uploadedData.source.id}`, {
      method: "DELETE",
      userId: admin.id,
    });

    expect(deleteUploaded.status).toBe(204);
    await expect(stat(join(uploadedRoot, "greeter"))).rejects.toThrow();
  });

  test("discovers and executes built-in example-utils plugin from repo plugins directory", async () => {
    const repoPluginsDir = resolve(import.meta.dir, "../../../plugins");
    const harness = createTestHarness({ localPluginsRoot: repoPluginsDir });
    const admin = harness.seedUser({
      id: "admin-ex",
      email: "admin@mux.dev",
      name: "Admin",
      role: "admin",
    });

    const localList = (
      await (await harness.request("/v1/sources/plugins/local", { userId: admin.id })).json()
    ).plugins as Array<{ directoryName: string }>;

    expect(localList.some((p) => p.directoryName === "example-utils")).toBe(true);

    await harness.request("/v1/sources/plugins/local", {
      method: "POST",
      userId: admin.id,
      body: { directoryName: "example-utils" },
    });

    const tools = (await (await harness.request("/v1/tools", { userId: admin.id })).json())
      .tools as Array<{ id: string; slug: string }>;
    const slugify = tools.find((t) => t.slug === "example-utils__slugify");

    const execRes = await harness.request(`/v1/tools/${slugify?.id}/execute`, {
      method: "POST",
      userId: admin.id,
      body: { arguments: { text: "Hello Mux Platform!" } },
    });

    expect(execRes.status).toBe(200);
    expect((await execRes.json()).result.structuredContent).toEqual({ slug: "hello-mux-platform" });
  });
});
