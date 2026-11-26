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
  test("executes local plugin with scrubbed parent env, explicit secret injection, and safe stdout framing", async () => {
    const { localRoot, uploadRoot } = await makeTempWorkspace();
    const pluginDir = join(localRoot, "env-check");

    await mkdir(pluginDir, { recursive: true });
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
        ],
      }),
    );
    await writeFile(
      join(pluginDir, "index.ts"),
      [
        "export const inspectEnv = (args, ctx) => {",
        '  console.log("noisy debug output that must not break protocol");',
        "  return {",
        "    label: args.label,",
        "    allowed: ctx.env.ALLOWED_TOKEN ?? null,",
        "    undeclared: ctx.env.UNDECLARED_TOKEN ?? null,",
        "    parentLeak: ctx.env.MUX_PARENT_SECRET_TEST ?? null,",
        "  };",
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
      const discovered = await runtime.listLocalPlugins();

      expect(discovered.length).toBe(1);
      expect(discovered[0].directoryName).toBe("env-check");

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
        label: "hello",
        allowed: "plugin-secret-ok",
        undeclared: null,
        parentLeak: null,
      });
    } finally {
      if (prevParentSecret === undefined) {
        delete process.env.MUX_PARENT_SECRET_TEST;
      } else {
        process.env.MUX_PARENT_SECRET_TEST = prevParentSecret;
      }
    }
  });

  test("kills timed-out plugins and blocks symlink escapes outside plugin directory", async () => {
    const { root, localRoot, uploadRoot } = await makeTempWorkspace();
    const slowDir = join(localRoot, "slow-plugin");

    await mkdir(slowDir, { recursive: true });
    await writeFile(
      join(slowDir, "index.ts"),
      "export const hang = async () => { await new Promise((resolve) => setTimeout(resolve, 10_000)); };",
    );

    const outsideFile = join(root, "outside.ts");

    await writeFile(outsideFile, 'export const pwn = () => "escaped";');

    const escapeDir = join(localRoot, "symlink-escape");

    await mkdir(escapeDir, { recursive: true });
    await symlink(outsideFile, join(escapeDir, "index.ts"));

    const runtime = createPluginRuntime({
      localPluginsRoot: localRoot,
      uploadedPluginsRoot: uploadRoot,
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
        directoryName: "symlink-escape",
        entry: "./index.ts",
        handlerName: "pwn",
        args: {},
        requiredSecrets: [],
        timeoutMs: 2000,
      }),
    ).rejects.toThrow("escapes");
  });

  test("installs, executes, validates bounds on, and removes uploaded plugin bundles", async () => {
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
        { path: "../escape.ts", content: "export const x = 1;" },
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
