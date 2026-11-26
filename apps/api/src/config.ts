import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_PLUGINS_DIR = resolve(REPO_ROOT, "plugins");
const DEFAULT_PLUGINS_DATA_DIR = resolve(REPO_ROOT, ".data/plugins");

const parseAndValidateCorsOrigins = (raw: string, ctx: z.RefinementCtx): string[] => {
  const origins: string[] = [];

  for (const part of raw.split(",")) {
    const trimmed = part.trim();

    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed === "*") {
      ctx.addIssue({
        code: "custom",
        message: "CORS_ORIGIN cannot contain wildcard '*' when credentials are enabled.",
      });

      return z.NEVER;
    }

    let parsed: URL;

    try {
      parsed = new URL(trimmed);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: `Invalid CORS origin '${trimmed}'.`,
      });

      return z.NEVER;
    }

    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.origin !== trimmed
    ) {
      ctx.addIssue({
        code: "custom",
        message: `CORS origin '${trimmed}' must be an exact http/https origin without path or trailing slash.`,
      });

      return z.NEVER;
    }

    origins.push(trimmed);
  }

  if (origins.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "CORS_ORIGIN must specify at least one valid origin.",
    });

    return z.NEVER;
  }

  return origins;
};

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().trim().min(1).default("postgres://postgres@localhost:5432/mux"),
  REDIS_URL: z.string().trim().min(1).default("redis://localhost:6379"),
  MUX_MASTER_KEY: z.string().trim().min(32, "MUX_MASTER_KEY must be at least 32 characters."),
  BETTER_AUTH_SECRET: z
    .string()
    .trim()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters."),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .transform((raw, ctx) => parseAndValidateCorsOrigins(raw, ctx)),
  PLUGINS_DIR: z.string().trim().min(1).default(DEFAULT_PLUGINS_DIR),
  PLUGINS_DATA_DIR: z.string().trim().min(1).default(DEFAULT_PLUGINS_DATA_DIR),
});

export type ApiConfig = z.infer<typeof envSchema>;

export const parseApiConfig = (env: Record<string, string | undefined>): ApiConfig =>
  envSchema.parse(env);
