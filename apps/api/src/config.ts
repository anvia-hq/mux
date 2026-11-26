import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1).default("postgres://postgres@localhost:5432/mux"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  MUX_MASTER_KEY: z.string().min(32, "MUX_MASTER_KEY must be at least 32 characters."),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters."),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
});

export type ApiConfig = z.infer<typeof envSchema>;

export const parseApiConfig = (env: Record<string, string | undefined>): ApiConfig =>
  envSchema.parse(env);
