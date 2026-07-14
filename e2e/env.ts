export const e2eApiPort = process.env.E2E_API_PORT ?? "8010";
export const e2ePlatformPort = process.env.E2E_PLATFORM_PORT ?? "3010";
export const e2eRequestLogWorkerPort = process.env.E2E_REQUEST_LOG_WORKER_PORT ?? "8020";
export const e2eResponsesUpstreamPort = process.env.E2E_RESPONSES_UPSTREAM_PORT ?? "8030";

export const e2eApiUrl = `http://127.0.0.1:${e2eApiPort}`;
export const e2ePlatformUrl = `http://127.0.0.1:${e2ePlatformPort}`;
export const e2eRequestLogWorkerUrl = `http://127.0.0.1:${e2eRequestLogWorkerPort}`;
export const e2eResponsesUpstreamUrl = `http://127.0.0.1:${e2eResponsesUpstreamPort}`;

export const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5435/monorepo_template_e2e?schema=public";

export const e2eRedisUrl = process.env.E2E_REDIS_URL ?? "redis://localhost:6383";
export const e2eResetToken = process.env.E2E_RESET_TOKEN ?? "e2e-reset-token";

export const e2eRuntimeEnv = {
  API_PORT: e2eApiPort,
  AUTH_COOKIE_SECURE: "false",
  AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? "e2e-auth-secret-change-me",
  CLIENT_ORIGINS: e2ePlatformUrl,
  DATABASE_URL: e2eDatabaseUrl,
  E2E_RESET_TOKEN: e2eResetToken,
  E2E_REQUEST_LOG_WORKER_PORT: e2eRequestLogWorkerPort,
  E2E_RESPONSES_UPSTREAM_PORT: e2eResponsesUpstreamPort,
  ANTHROPIC_MESSAGES_API_URL: `${e2eResponsesUpstreamUrl}/v1/messages`,
  PROVIDER_KEYS_ENCRYPTION_KEY:
    process.env.E2E_PROVIDER_KEYS_ENCRYPTION_KEY ?? "e2e-provider-key-change-me",
  REDIS_URL: e2eRedisUrl,
  RESPONSES_FIRST_BYTE_TIMEOUT_MS: "400",
  RESPONSES_NON_STREAM_TIMEOUT_MS: "600",
  RESPONSES_STREAM_IDLE_TIMEOUT_MS: "400",
  MESSAGES_FIRST_BYTE_TIMEOUT_MS: "400",
  MESSAGES_NON_STREAM_TIMEOUT_MS: "600",
  MESSAGES_STREAM_IDLE_TIMEOUT_MS: "400",
  EMBEDDINGS_NON_STREAM_TIMEOUT_MS: "600",
} satisfies Record<string, string>;

export const e2ePlatformEnv = {
  VITE_API_URL: e2eApiUrl,
} satisfies Record<string, string>;
