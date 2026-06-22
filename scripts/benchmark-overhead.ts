import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RuntimeEnv = Record<string, string | undefined>;
type Logger = (message: string) => void;

type BenchmarkConfig = {
  model: string;
  muxModel: string;
  requests: number;
  warmup: number;
  streamRequests: number;
  concurrency: number;
  output: string;
  muxBaseUrl: string;
  muxApiBaseUrl: string;
  directChatCompletionsUrl: string;
  openAiKey: string;
  muxApiKey?: string;
  adminEmail?: string;
  adminPassword?: string;
};

type LatencyStats = {
  count: number;
  failures: number;
  minMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  avgMs: number | null;
};

type SampleResult = {
  latencyMs: number;
  firstChunkMs?: number;
};

type BenchmarkResults = {
  metadata: {
    timestamp: string;
    nodeVersion: string;
    model: string;
    muxModel: string;
    muxBaseUrl: string;
    directChatCompletionsUrl: string;
    requests: number;
    streamRequests: number;
    warmup: number;
    concurrency: number;
  };
  setup: {
    temporaryMuxApiKeyId: string | null;
    usedExistingMuxApiKey: boolean;
    configuredOpenAIProvider: boolean;
  };
  nonStreaming: ComparisonResult;
  streaming: {
    firstChunk: ComparisonResult;
    total: ComparisonResult;
  };
};

type ComparisonResult = {
  direct: LatencyStats;
  mux: LatencyStats;
  overheadMs: number | null;
  overheadPercent: number | null;
};

type RunSamplesResult = {
  samples: SampleResult[];
  failures: string[];
};

type CleanupState = {
  muxApiKeyId?: string;
  configuredOpenAIProvider?: boolean;
};

type ProviderSetupClient = {
  getProviders(): Promise<Array<{ provider: string }>>;
  setOpenAIProvider(apiKey: string): Promise<void>;
};

type CleanupClient = {
  revokeApiKey(id: string): Promise<void>;
  deleteOpenAIProvider(): Promise<void>;
};

type BenchmarkRequestInput = {
  model: string;
  stream?: boolean;
};

const DEFAULT_MUX_BASE_URL = "http://localhost";
const DIRECT_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

export function parseArgs(argv: string[], env: RuntimeEnv = process.env): BenchmarkConfig {
  const args = parseFlagArgs(argv);
  const model = stringArg(args, "model", "gpt-5.4-mini");
  const muxBaseUrl = normalizeBaseUrl(
    stringArg(args, "mux-base-url", env.MUX_BASE_URL ?? DEFAULT_MUX_BASE_URL),
  );

  return {
    model,
    muxModel: `openai:${model}`,
    requests: positiveIntArg(args, "requests", 30),
    warmup: nonNegativeIntArg(args, "warmup", 5),
    streamRequests: positiveIntArg(args, "stream-requests", 20),
    concurrency: positiveIntArg(args, "concurrency", 1),
    output: stringArg(
      args,
      "output",
      `benchmark-results/overhead-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    ),
    muxBaseUrl,
    muxApiBaseUrl: `${muxBaseUrl}/api`,
    directChatCompletionsUrl: DIRECT_CHAT_COMPLETIONS_URL,
    openAiKey: requiredEnv(env, "OPENAI_API_KEY"),
    muxApiKey: optionalEnv(env, "MUX_API_KEY"),
    adminEmail: optionalEnv(env, "MUX_ADMIN_EMAIL"),
    adminPassword: optionalEnv(env, "MUX_ADMIN_PASSWORD"),
  };
}

export async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResults> {
  return runBenchmarkWithLogger(config);
}

export async function runBenchmarkWithLogger(
  config: BenchmarkConfig,
  log: Logger = () => undefined,
): Promise<BenchmarkResults> {
  const useExistingMuxApiKey = Boolean(config.muxApiKey);
  const adminClient = useExistingMuxApiKey ? null : new MuxAdminClient(config.muxApiBaseUrl);
  const cleanup: CleanupState = {};

  try {
    log(`Benchmark target model: ${config.model}`);
    log(`Mux base URL: ${config.muxBaseUrl}`);
    log(
      useExistingMuxApiKey
        ? "Using existing Mux API key from MUX_API_KEY."
        : "No MUX_API_KEY provided; creating a temporary key via admin login.",
    );

    let muxApiKey = config.muxApiKey;

    if (!muxApiKey) {
      if (!config.adminEmail || !config.adminPassword) {
        throw new Error(
          "Set MUX_API_KEY, or set both MUX_ADMIN_EMAIL and MUX_ADMIN_PASSWORD so the benchmark can create a temporary key.",
        );
      }

      if (!adminClient) {
        throw new Error("Admin client was not initialized");
      }

      log(`Logging in as ${config.adminEmail}.`);
      await adminClient.login(config.adminEmail, config.adminPassword);
      log("Checking OpenAI provider configuration in Mux.");
      cleanup.configuredOpenAIProvider = await ensureOpenAIProvider(adminClient, config.openAiKey);
      if (cleanup.configuredOpenAIProvider) {
        log("Configured OpenAI provider temporarily for this benchmark.");
      }

      log("Creating temporary Mux API key.");
      const apiKey = await adminClient.createApiKey(
        `Overhead benchmark ${new Date().toISOString()}`,
      );
      cleanup.muxApiKeyId = apiKey.id;
      muxApiKey = apiKey.key;
    }

    await runWarmups(config, muxApiKey, log);

    const directNonStreaming = await runSamples(
      "Direct non-streaming",
      config.requests,
      config.concurrency,
      log,
      () => measureJsonCompletion(config.directChatCompletionsUrl, config.openAiKey, config.model),
    );
    const muxNonStreaming = await runSamples(
      "Mux non-streaming",
      config.requests,
      config.concurrency,
      log,
      () =>
        measureJsonCompletion(
          `${config.muxApiBaseUrl}/v1/chat/completions`,
          muxApiKey,
          config.muxModel,
        ),
    );
    const directStreaming = await runSamples(
      "Direct streaming",
      config.streamRequests,
      config.concurrency,
      log,
      () =>
        measureStreamingCompletion(config.directChatCompletionsUrl, config.openAiKey, config.model),
    );
    const muxStreaming = await runSamples(
      "Mux streaming",
      config.streamRequests,
      config.concurrency,
      log,
      () =>
        measureStreamingCompletion(
          `${config.muxApiBaseUrl}/v1/chat/completions`,
          muxApiKey,
          config.muxModel,
        ),
    );

    return {
      metadata: {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        model: config.model,
        muxModel: config.muxModel,
        muxBaseUrl: config.muxBaseUrl,
        directChatCompletionsUrl: config.directChatCompletionsUrl,
        requests: config.requests,
        streamRequests: config.streamRequests,
        warmup: config.warmup,
        concurrency: config.concurrency,
      },
      setup: {
        temporaryMuxApiKeyId: cleanup.muxApiKeyId ?? null,
        usedExistingMuxApiKey: useExistingMuxApiKey,
        configuredOpenAIProvider: cleanup.configuredOpenAIProvider ?? false,
      },
      nonStreaming: compareSamples(directNonStreaming, muxNonStreaming, "latencyMs"),
      streaming: {
        firstChunk: compareSamples(directStreaming, muxStreaming, "firstChunkMs"),
        total: compareSamples(directStreaming, muxStreaming, "latencyMs"),
      },
    };
  } finally {
    if (adminClient) {
      try {
        await cleanupBenchmarkState(adminClient, cleanup);
      } catch (error) {
        console.warn(error instanceof Error ? error.message : error);
      }
    }
  }
}

export function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

export function summarizeLatencies(values: number[], failures = 0): LatencyStats {
  if (values.length === 0) {
    return {
      count: 0,
      failures,
      minMs: null,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
      avgMs: null,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    failures,
    minMs: roundMs(Math.min(...values)),
    p50Ms: roundMs(percentile(values, 50) ?? 0),
    p95Ms: roundMs(percentile(values, 95) ?? 0),
    maxMs: roundMs(Math.max(...values)),
    avgMs: roundMs(total / values.length),
  };
}

export function compareSamples(
  direct: RunSamplesResult,
  mux: RunSamplesResult,
  metric: keyof SampleResult,
): ComparisonResult {
  const directStats = summarizeLatencies(
    direct.samples.flatMap((sample) => valueForMetric(sample, metric)),
    direct.failures.length,
  );
  const muxStats = summarizeLatencies(
    mux.samples.flatMap((sample) => valueForMetric(sample, metric)),
    mux.failures.length,
  );
  const overheadMs =
    directStats.p50Ms === null || muxStats.p50Ms === null
      ? null
      : roundMs(muxStats.p50Ms - directStats.p50Ms);
  const overheadPercent =
    overheadMs === null || directStats.p50Ms === null || directStats.p50Ms === 0
      ? null
      : roundPercent((overheadMs / directStats.p50Ms) * 100);

  return {
    direct: directStats,
    mux: muxStats,
    overheadMs,
    overheadPercent,
  };
}

export function formatResultsTable(results: BenchmarkResults): string {
  const rows = [
    formatResultRow("Non-stream total", results.nonStreaming),
    formatResultRow("Stream first chunk", results.streaming.firstChunk),
    formatResultRow("Stream total", results.streaming.total),
  ];
  const headers = [
    "Metric",
    "Direct p50",
    "Mux p50",
    "Overhead",
    "Overhead %",
    "Direct p95",
    "Mux p95",
  ];
  const tableRows = [headers, ...rows];
  const widths = headers.map((_, index) =>
    Math.max(...tableRows.map((row) => row[index]?.length ?? 0)),
  );

  return tableRows
    .map((row, rowIndex) => {
      const line = row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
      if (rowIndex === 0) {
        const divider = widths.map((width) => "-".repeat(width)).join("  ");
        return `${line}\n${divider}`;
      }
      return line;
    })
    .join("\n");
}

export function buildBenchmarkChatRequest(input: BenchmarkRequestInput): Record<string, unknown> {
  return {
    model: input.model,
    messages: [
      {
        role: "user",
        content: input.stream
          ? "Stream a numbered list with three short items."
          : "Reply with one short sentence about API latency.",
      },
    ],
    max_completion_tokens: input.stream ? 64 : 32,
    ...(input.stream
      ? {
          stream: true,
          stream_options: { include_usage: true },
        }
      : {}),
  };
}

export async function ensureOpenAIProvider(
  client: ProviderSetupClient,
  apiKey: string,
): Promise<boolean> {
  const providers = await client.getProviders();
  if (providers.some((provider) => provider.provider === "openai")) {
    return false;
  }

  await client.setOpenAIProvider(apiKey);
  return true;
}

export async function cleanupBenchmarkState(
  client: CleanupClient,
  cleanup: CleanupState,
): Promise<void> {
  const errors: unknown[] = [];

  if (cleanup.muxApiKeyId) {
    try {
      await client.revokeApiKey(cleanup.muxApiKeyId);
    } catch (error) {
      errors.push(error);
    }
  }

  if (cleanup.configuredOpenAIProvider) {
    try {
      await client.deleteOpenAIProvider();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Benchmark cleanup failed: ${errors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join("; ")}`,
    );
  }
}

class MuxAdminClient {
  private cookie = "";

  constructor(private readonly apiBaseUrl: string) {}

  async login(email: string, password: string): Promise<void> {
    await this.request("/auth/login", {
      method: "POST",
      body: { email, password },
    });
  }

  async getProviders(): Promise<Array<{ provider: string }>> {
    const data = await this.request<{ providers: Array<{ provider: string }> }>("/providers");
    return data.providers;
  }

  async setOpenAIProvider(apiKey: string): Promise<void> {
    await this.request("/providers/openai", {
      method: "PUT",
      body: { apiKey },
    });
  }

  async deleteOpenAIProvider(): Promise<void> {
    await this.request("/providers/openai", { method: "DELETE" });
  }

  async createApiKey(name: string): Promise<{ id: string; key: string }> {
    return this.request<{ id: string; key: string }>("/api-keys", {
      method: "POST",
      body: { name },
    });
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.request(`/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  private async request<T = unknown>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    this.storeCookies(response.headers);

    const data = (await response.json().catch(() => null)) as T | { error?: string } | null;

    if (!response.ok) {
      const message =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : `HTTP ${response.status}`;
      throw new Error(`${options.method ?? "GET"} ${path} failed: ${message}`);
    }

    return data as T;
  }

  private storeCookies(headers: Headers): void {
    const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookieHeaders =
      typeof getSetCookie === "function"
        ? getSetCookie.call(headers)
        : headers.get("set-cookie")
          ? [headers.get("set-cookie") as string]
          : [];
    if (setCookieHeaders.length === 0) return;

    const cookieParts = new Map(
      this.cookie
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const separator = part.indexOf("=");
          return [part.slice(0, separator), part.slice(separator + 1)] as const;
        }),
    );

    for (const header of setCookieHeaders) {
      const firstPart = header.split(";")[0]?.trim();
      if (!firstPart) continue;
      const separator = firstPart.indexOf("=");
      if (separator <= 0) continue;
      cookieParts.set(firstPart.slice(0, separator), firstPart.slice(separator + 1));
    }

    this.cookie = Array.from(cookieParts, ([key, value]) => `${key}=${value}`).join("; ");
  }
}

async function main(): Promise<void> {
  await loadDotEnvFile(".env");
  const config = parseArgs(process.argv.slice(2));
  const results = await runBenchmarkWithLogger(config, (message) => {
    console.log(`[benchmark] ${message}`);
  });

  await writeJson(config.output, results);

  console.log("");
  console.log(`Mux overhead benchmark (${results.metadata.model})`);
  console.log(formatResultsTable(results));
  console.log("");
  console.log(`JSON written to ${resolve(config.output)}`);
}

async function runWarmups(
  config: BenchmarkConfig,
  muxApiKey: string,
  log: Logger = () => undefined,
): Promise<void> {
  if (config.warmup === 0) {
    log("Skipping warmup.");
    return;
  }

  log(`Starting warmup: ${config.warmup} iteration(s).`);
  for (let i = 0; i < config.warmup; i += 1) {
    await measureJsonCompletion(config.directChatCompletionsUrl, config.openAiKey, config.model);
    await measureJsonCompletion(
      `${config.muxApiBaseUrl}/v1/chat/completions`,
      muxApiKey,
      config.muxModel,
    );
    await measureStreamingCompletion(
      config.directChatCompletionsUrl,
      config.openAiKey,
      config.model,
    );
    await measureStreamingCompletion(
      `${config.muxApiBaseUrl}/v1/chat/completions`,
      muxApiKey,
      config.muxModel,
    );
    log(`Warmup ${i + 1}/${config.warmup} complete.`);
  }
}

export async function runSamples(
  label: string,
  count: number,
  concurrency: number,
  log: Logger,
  task: () => Promise<SampleResult>,
): Promise<RunSamplesResult> {
  const samples: SampleResult[] = [];
  const failures: string[] = [];
  let nextIndex = 0;
  let completed = 0;
  const progressInterval = Math.max(1, Math.floor(count / 10));

  log(`Starting ${label}: ${count} request(s), concurrency ${concurrency}.`);

  async function worker(): Promise<void> {
    while (nextIndex < count) {
      nextIndex += 1;
      try {
        samples.push(await task());
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
      completed += 1;
      if (completed === count || completed % progressInterval === 0) {
        log(`${label}: ${completed}/${count} complete (${failures.length} failed).`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, () => worker()));
  log(`${label} finished: ${samples.length} succeeded, ${failures.length} failed.`);
  return { samples, failures };
}

async function measureJsonCompletion(
  url: string,
  apiKey: string,
  model: string,
): Promise<SampleResult> {
  const startedAt = performance.now();
  const response = await postChatCompletion(url, apiKey, buildBenchmarkChatRequest({ model }));

  await response.json();
  return { latencyMs: performance.now() - startedAt };
}

async function measureStreamingCompletion(
  url: string,
  apiKey: string,
  model: string,
): Promise<SampleResult> {
  const startedAt = performance.now();
  const response = await postChatCompletion(
    url,
    apiKey,
    buildBenchmarkChatRequest({ model, stream: true }),
  );

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response did not include a body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let firstChunkMs: number | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") {
        return {
          firstChunkMs: firstChunkMs ?? performance.now() - startedAt,
          latencyMs: performance.now() - startedAt,
        };
      }
      if (firstChunkMs === undefined) {
        firstChunkMs = performance.now() - startedAt;
      }
    }
  }

  return {
    firstChunkMs: firstChunkMs ?? performance.now() - startedAt,
    latencyMs: performance.now() - startedAt,
  };
}

async function postChatCompletion(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => "");
    throw new Error(`POST ${url} failed: ${response.status} ${error}`);
  }

  return response;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadDotEnvFile(path: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = unquoteEnvValue(trimmed.slice(separator + 1).trim());
    process.env[key] ??= value;
  }
}

export function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function formatResultRow(label: string, result: ComparisonResult): string[] {
  return [
    label,
    formatMs(result.direct.p50Ms),
    formatMs(result.mux.p50Ms),
    formatMs(result.overheadMs),
    result.overheadPercent === null ? "-" : `${result.overheadPercent.toFixed(2)}%`,
    formatMs(result.direct.p95Ms),
    formatMs(result.mux.p95Ms),
  ];
}

function valueForMetric(sample: SampleResult, metric: keyof SampleResult): number[] {
  const value = sample[metric];
  return typeof value === "number" && Number.isFinite(value) ? [value] : [];
}

function formatMs(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(2)} ms`;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseFlagArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      args.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${withoutPrefix}`);
    }
    args.set(withoutPrefix, next);
    index += 1;
  }

  return args;
}

function stringArg(args: Map<string, string>, key: string, fallback: string): string {
  return args.get(key)?.trim() || fallback;
}

function positiveIntArg(args: Map<string, string>, key: string, fallback: number): number {
  const value = Number(args.get(key) ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${key} must be a positive integer`);
  }
  return value;
}

function nonNegativeIntArg(args: Map<string, string>, key: string, fallback: number): number {
  const value = Number(args.get(key) ?? fallback);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${key} must be a non-negative integer`);
  }
  return value;
}

function requiredEnv(env: RuntimeEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalEnv(env: RuntimeEnv, key: string): string | undefined {
  return env[key]?.trim() || undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
