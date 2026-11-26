import { z } from "zod";
import { createDefaultCachePolicy, toolCachePolicySchema } from "./cache/schema";

const SLUG_PATTERN = /^(?!.*__)[a-z][a-z0-9_-]{0,63}$/;
const HANDLER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_ENTRY_PATTERN =
  /^(?:\.\/)?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:ts|mts|js|mjs)$/;
const RESERVED_HANDLER_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const RESERVED_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "SHELL",
  "USER",
  "NODE_ENV",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
]);
const RESERVED_ENV_PREFIXES = ["LD_", "DYLD_", "BUN_", "NODE_"];

export const isReservedSecretEnvName = (name: string): boolean => {
  const upper = name.toUpperCase();

  if (RESERVED_ENV_NAMES.has(upper)) {
    return true;
  }

  for (const prefix of RESERVED_ENV_PREFIXES) {
    if (upper.startsWith(prefix)) {
      return true;
    }
  }

  return false;
};

const isSafeRelativeEntry = (entry: string): boolean => {
  if (!SAFE_ENTRY_PATTERN.test(entry)) {
    return false;
  }

  const normalized = entry.startsWith("./") ? entry.slice(2) : entry;
  const segments = normalized.split("/");

  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.length === 0 || segment.startsWith(".")) {
      return false;
    }
  }

  return true;
};

export const jsonSchemaObjectSchema = z
  .record(z.string(), z.unknown())
  .refine((schema) => schema.type === "object", {
    message: "Tool inputSchema must declare top-level type: 'object'.",
  });

export const pluginToolManifestSchema = z.object({
  name: z
    .string()
    .regex(SLUG_PATTERN, "Tool name must be a lowercase slug without double underscores."),
  description: z.string().min(1).max(1000),
  handler: z
    .string()
    .regex(HANDLER_PATTERN, "Handler must be a valid exported identifier.")
    .refine((name) => !RESERVED_HANDLER_NAMES.has(name), {
      message: "Handler name cannot be a reserved prototype property.",
    }),
  readOnly: z.boolean().default(false),
  destructive: z.boolean().default(false),
  idempotent: z.boolean().default(false),
  inputSchema: jsonSchemaObjectSchema,
  cache: toolCachePolicySchema.optional(),
});

export const pluginManifestSchema = z
  .object({
    name: z
      .string()
      .regex(SLUG_PATTERN, "Plugin name must be a lowercase slug without double underscores."),
    version: z.string().regex(SEMVER_PATTERN, "Plugin version must be valid semver."),
    description: z.string().max(1000).optional(),
    entry: z.string().refine(isSafeRelativeEntry, {
      message: "Plugin entry must be a safe non-hidden relative .ts/.mts/.js/.mjs path.",
    }),
    secrets: z
      .array(
        z
          .string()
          .regex(ENV_NAME_PATTERN, "Secret names must be UPPER_SNAKE_CASE.")
          .refine((name) => !isReservedSecretEnvName(name), {
            message: "Reserved OS/runtime environment variable names are not allowed as secrets.",
          }),
      )
      .max(50)
      .default([]),
    timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
    tools: z.array(pluginToolManifestSchema).min(1).max(100),
  })
  .superRefine((manifest, ctx) => {
    const seenTools = new Set<string>();

    for (let i = 0; i < manifest.tools.length; i += 1) {
      const tool = manifest.tools[i];

      if (seenTools.has(tool.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["tools", i, "name"],
          message: `Duplicate tool name '${tool.name}' in plugin manifest.`,
        });
      }

      seenTools.add(tool.name);
    }

    const seenSecrets = new Set<string>();

    for (let i = 0; i < manifest.secrets.length; i += 1) {
      const secret = manifest.secrets[i];

      if (seenSecrets.has(secret)) {
        ctx.addIssue({
          code: "custom",
          path: ["secrets", i],
          message: `Duplicate secret '${secret}' in plugin manifest.`,
        });
      }

      seenSecrets.add(secret);
    }
  });

export type PluginToolManifest = z.infer<typeof pluginToolManifestSchema>;
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export const parsePluginManifest = (raw: unknown): PluginManifest =>
  pluginManifestSchema.parse(raw);

export const buildToolSlug = (sourceSlug: string, toolName: string): string =>
  `${sourceSlug}__${toolName}`;

export { createDefaultCachePolicy, toolCachePolicySchema };
