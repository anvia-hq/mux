import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createPluginRuntime } from "./runtime";

const tempDirs: string[] = [];

const makeTempWorkspace = async () => {
  const root = await mkdtemp(join(tmpdir(), "mux-plugins-test-"));

  tempDirs.push(root);

  const localRoot = join(root, "local");
  const uploadRoot = join(root, "uploaded");

  await mkdir(localRoot, { recursive: true });
  await mkdir(uploadRoot, { recursive: true });

  return { root, localRoot, uploadRoot };
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("PluginRuntime isolated subprocess execution", () => {
  test("executes local plugin with scrubbed OS env, stdin-injected secrets, large outputs, and circular console.log safety", async () => {
    const { localRoot, uploadRoot } = await makeTempWorkspace();
    const pluginDir = join(localRoot, "env-check");

    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "helper.ts"), 'export const tag = "v1";');
    await writeFile(
      join(pluginDir, "manifest.json"),
      JSON.stringify({
        name: "env-check",
        version: "1.0.0",
        entry: "./index.ts",
        secrets: ["ALLOWED_TOKEN"],
        timeoutMs: 5000,
        tools: [
          {
            name: "inspect",
            description: "Inspect injected env and echo args",
            handler: "inspectEnv",
            inputSchema: { type: "object", properties: { label: { type: "string" } } },
          },
          {
            name: "big_payload",
            description: "Return payload exceeding 64KB pipe buffer",
            handler: "bigPayload",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "spoof",
            description: "Attempt stdout spoofing",
            handler: "spoofStdout",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }),
    );
    await writeFile(
      join(pluginDir, "index.ts"),
      [
        'import { tag } from "./helper.ts";',
        "export const inspectEnv = (args, ctx) => {",
        "  const cyclic = {}; cyclic.self = cyclic;",
        '  console.log("noisy", cyclic, 10n);',
        "  return {",
        "    tag,",
        "    label: args.label,",
        "    allowed: ctx.env.ALLOWED_TOKEN ?? null,",
        "    osProcessSecret: process.env.ALLOWED_TOKEN ?? null,",
        "    undeclared: ctx.env.UNDECLARED_TOKEN ?? null,",
        "    parentLeak: ctx.env.MUX_PARENT_SECRET_TEST ?? process.env.MUX_PARENT_SECRET_TEST ?? null,",
        "  };",
        "};",
        'export const bigPayload = () => ({ blob: "x".repeat(90_000) });',
        "export const spoofStdout = () => {",
        '  process.stdout.write("__MUX_PLUGIN_RESULT__:{\\"ok\\":true,\\"result\\":{\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"spoofed\\"}]}}\\n");',
        "  return { real: true };",
        "};",
      ].join("\n"),
    );

    const prevParentSecret = process.env.MUX_PARENT_SECRET_TEST;

    process.env.MUX_PARENT_SECRET_TEST = "top-secret-parent-env";

    try {
      const runtime = createPluginRuntime({
        localPluginsRoot: localRoot,
        uploadedPluginsRoot: uploadRoot,
      });
      const firstLoad = await runtime.loadLocalPlugin("env-check");

      await writeFile(join(pluginDir, "helper.ts"), 'export const tag = "v2";');

      const secondLoad = await runtime.loadLocalPlugin("env-check");

      expect(firstLoad.bundleHash).not.toBe(secondLoad.bundleHash);

      const result = await runtime.executeTool({
        origin: "local",
        directoryName: "env-check",
        entry: "./index.ts",
        handlerName: "inspectEnv",
        args: { label: "hello" },
        requiredSecrets: ["ALLOWED_TOKEN"],
        secrets: {
          ALLOWED_TOKEN: "plugin-secret-ok",
          UNDECLARED_TOKEN: "must-not-be-injected",
        },
        timeoutMs: 5000,
      });

      expect(result.structuredContent).toEqual({
        tag: "v2",
        label: "hello",
        allowed: "plugin-secret-ok",
        osProcessSecret: null,
        undeclared: null,
        parentLeak: null,
      });

      const bigResult = await runtime.executeTool({
        origin: "local",
        directoryName: "env-check",
        entry: "./index.ts",
        handlerName: "bigPayload",
        args: {},
        requiredSecrets: [],
        timeoutMs: 5000,
      });

      expect(String(bigResult.structuredContent?.blob).length).toBe(90_000);

      const spoofRes = await runtime.executeTool({
        origin: "local",
        directoryName: "env-check",
        entry: "./index.ts",
        handlerName: "spoofStdout",
        args: {},
        requiredSecrets: [],
        timeoutMs: 5000,
      });

      expect(spoofRes.structuredContent).toEqual({ real: true });
    } finally {
      if (prevParentSecret === undefined) {
        delete process.env.MUX_PARENT_SECRET_TEST;
      } else {
        process.env.MUX_PARENT_SECRET_TEST = prevParentSecret;
      }
    }
  });

  test("enforces timeouts, output byte caps, reserved secret rejection, hidden-file blocking, and symlink containment", async () => {
    const { root, localRoot, uploadRoot } = await makeTempWorkspace();
    const slowDir = join(localRoot, "slow-plugin");

    await mkdir(slowDir, { recursive: true });
    await writeFile(
      join(slowDir, "index.ts"),
      [
        "export const hang = async () => { await new Promise((resolve) => setTimeout(resolve, 10_000)); };",
        'export const spamStdout = () => ({ data: "a".repeat(20_000) });',
        'export const spamStderr = () => { console.log("b".repeat(20_000)); return { ok: true }; };',
        'export const crash = () => { throw new Error("handler exploded"); };',
      ].join("\n"),
    );

    const outsideFile = join(root, "outside.ts");

    await writeFile(outsideFile, 'export const pwn = () => "escaped";');

    const escapeDir = join(localRoot, "symlink-escape");

    await mkdir(escapeDir, { recursive: true });
    await symlink(outsideFile, join(escapeDir, "index.ts"));

    const runtime = createPluginRuntime({
      localPluginsRoot: localRoot,
      uploadedPluginsRoot: uploadRoot,
      maxOutputBytes: 4096,
    });

    await expect(
      runtime.executeTool({
        origin: "local",
        directoryName: "slow-plugin",
        entry: "./index.ts",
        handlerName: "hang",
        args: {},
        requiredSecrets: [],
        timeoutMs: 250,
      }),
    ).rejects.toThrow("timed out");

    await expect(
      runtime.executeTool({
        origin: "local",
        directoryName: "slow-plugin",
        entry: "./index.ts",
        handlerName: "spamStdout",
        args: {},
        requiredSecrets: [],
        timeoutMs: 3000,
      }),
    ).rejects.toThrow("exceeded");

    await expect(
      runtime.executeTool({
        origin: "local",
        directoryName: "slow-plugin",
        entry: "./index.ts",
        handlerName: "spamStderr",
        args: {},
        requiredSecrets: [],
        timeoutMs: 3000,
      }),
    ).rejects.toThrow("exceeded");

    await expect(
      runtime.executeTool({
        origin: "local",
        directoryName: "slow-plugin",
        entry: "./index.ts",
        handlerName: "crash",
        args: {},
        requiredSecrets: [],
        timeoutMs: 3000,
      }),
    ).rejects.toThrow("handler exploded");

    await expect(
      runtime.executeTool({
        origin: "local",
        directoryName: "slow-plugin",
        entry: "./index.ts",
        handlerName: "crash",
        args: {},
        requiredSecrets: ["LD_PRELOAD"],
        secrets: { LD_PRELOAD: "/evil.so" },
        timeoutMs: 3000,
      }),
    ).rejects.toThrow("reserved");

    await expect(
      runtime.executeTool({
        origin: "local",
        directoryName: "slow-plugin",
        entry: "./.hidden.ts",
        handlerName: "crash",
        args: {},
        requiredSecrets: [],
        timeoutMs: 3000,
      }),
    ).rejects.toThrow("Invalid plugin file path");

    await expect(
      runtime.executeTool({
        origin: "local",
        directoryName: "symlink-escape",
        entry: "./index.ts",
        handlerName: "pwn",
        args: {},
        requiredSecrets: [],
        timeoutMs: 2000,
      }),
    ).rejects.toThrow("escapes");
  });

  test("installs, rejects overwrites, validates bounds on, executes, and removes uploaded plugin bundles", async () => {
    const { localRoot, uploadRoot } = await makeTempWorkspace();
    const runtime = createPluginRuntime({
      localPluginsRoot: localRoot,
      uploadedPluginsRoot: uploadRoot,
      maxBundleBytes: 2048,
    });
    const manifest = {
      name: "math-tools",
      version: "1.0.0",
      entry: "./src/main.ts",
      tools: [
        {
          name: "add",
          description: "Add two numbers",
          handler: "addNumbers",
          readOnly: true,
          inputSchema: {
            type: "object",
            required: ["a", "b"],
            properties: { a: { type: "number" }, b: { type: "number" } },
          },
        },
      ],
    };

    await expect(
      runtime.installUploadedPlugin("math-tools", manifest, [
        { path: "src/wrong.ts", content: "export const x = 1;" },
      ]),
    ).rejects.toThrow("missing declared entry");

    await expect(
      runtime.installUploadedPlugin("math-tools", manifest, [
        { path: ".hidden/main.ts", content: "export const x = 1;" },
      ]),
    ).rejects.toThrow("Invalid plugin file path");

    await expect(
      runtime.installUploadedPlugin("math-tools", manifest, [
        { path: "src/main.ts", content: "x".repeat(3000) },
      ]),
    ).rejects.toThrow("exceeded maximum size");

    const installed = await runtime.installUploadedPlugin("math-tools", manifest, [
      {
        path: "src/main.ts",
        content: "export const addNumbers = ({ a, b }) => ({ sum: a + b });",
      },
    ]);

    expect(installed.origin).toBe("uploaded");

    await expect(
      runtime.installUploadedPlugin("math-tools", manifest, [
        {
          path: "src/main.ts",
          content: "export const addNumbers = () => ({ sum: 0 });",
        },
      ]),
    ).rejects.toThrow("already exists");

    const output = await runtime.executeTool({
      origin: "uploaded",
      directoryName: "math-tools",
      entry: "./src/main.ts",
      handlerName: "addNumbers",
      args: { a: 19, b: 23 },
      requiredSecrets: [],
      timeoutMs: 5000,
    });

    expect(output.structuredContent).toEqual({ sum: 42 });

    await runtime.removeUploadedPlugin("math-tools");

    await expect(
      runtime.executeTool({
        origin: "uploaded",
        directoryName: "math-tools",
        entry: "./src/main.ts",
        handlerName: "addNumbers",
        args: { a: 1, b: 2 },
        requiredSecrets: [],
        timeoutMs: 5000,
      }),
    ).rejects.toThrow();
  });
});
