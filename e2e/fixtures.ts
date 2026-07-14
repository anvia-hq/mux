import {
  expect,
  test as base,
  type APIRequestContext,
  type BrowserContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import { e2eApiUrl, e2eResetToken, e2eResponsesUpstreamUrl } from "./env";

type AdminUser = {
  email: string;
  name: string;
  password: string;
};

type Fixtures = {
  resetState: undefined;
};

export const adminUser = {
  email: "admin@example.com",
  name: "E2E Admin",
  password: "password123",
} satisfies AdminUser;

export const regularUser = {
  email: "user@example.com",
  name: "E2E User",
  password: "password123",
} satisfies AdminUser;

export const syntheticProviderKey = "synthetic-e2e-provider-key";
export const syntheticProviderLastFour = syntheticProviderKey.slice(-4);
export const syntheticDeepSeekModelId = "hf:deepseek-ai/DeepSeek-R1";
export const providerSearchPlaceholder = "Search provider name, id, or URL...";
export const e2eProviderKey = "e2e-provider-key";
export const e2eProviderLastFour = e2eProviderKey.slice(-4);
export const e2eChatModel = "e2e:e2e-chat";
export const e2eBackupModel = "e2e:e2e-backup";
export const e2eFailModel = "e2e:e2e-fail";
export const e2eResponsesModel = "e2e:e2e-responses";
export const e2eUnbillableModel = "e2e:e2e-unbillable";

type SeedInput = {
  users?: Array<AdminUser & { role: "ADMIN" | "USER" }>;
  syntheticProvider?: boolean;
  e2eProvider?: boolean;
  anthropicProvider?: boolean;
  apiKeys?: Array<{
    name: string;
    createdByEmail?: string;
    spendLimitUsd?: number | null;
    isActive?: boolean;
  }>;
  requestLogs?: Array<{
    apiKeyName: string;
    provider: string;
    model: string;
    endpoint?: string;
    latencyMs?: number;
    providerLatencyMs?: number | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    estimatedCost?: number | null;
    statusCode?: number;
    errorMessage?: string | null;
    createdAt?: string;
  }>;
  fallbackGroups?: Array<{
    id: string;
    name: string;
    description?: string | null;
    enabled?: boolean;
    targets: Array<{ provider: string; modelId: string }>;
  }>;
  customProviders?: Array<{
    id: string;
    name?: string;
    apiBase: string;
    responsesMode: "native" | "via_chat";
    responsesEndpoint?: string;
    models: Array<{
      id: string;
      name?: string;
      inputPricePer1M?: number;
      outputPricePer1M?: number;
      contextWindow?: number;
      maxOutputTokens?: number;
      reasoning?: boolean;
      toolCall?: boolean;
      structuredOutput?: boolean;
    }>;
    channels: Array<{
      id: string;
      name?: string;
      apiKey: string;
      enabled?: boolean;
      priority?: number;
      weight?: number;
      headerOverride?: Record<string, string>;
    }>;
  }>;
};

type SeedResponse = {
  users: Array<{ email: string; name: string | null; role: "ADMIN" | "USER" }>;
  apiKeys: Array<{ id: string; name: string; rawKey: string; isActive: boolean }>;
  providerKeys: Array<{ provider: string; lastFour: string }>;
  requestLogs: Array<{ id: string; provider: string; model: string }>;
  fallbackGroups: Array<{ id: string; name: string; enabled: boolean }>;
  customProviders: Array<{
    id: string;
    responsesMode: "native" | "via_chat";
    modelIds: string[];
    channelIds: string[];
  }>;
};

export type E2eRequestLog = {
  id: string;
  apiKeyName: string;
  provider: string;
  model: string;
  requestedModel: string | null;
  channelId: string | null;
  channelName: string | null;
  endpoint: string;
  latencyMs: number;
  providerLatencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  estimatedCost: number | null;
  statusCode: number;
  errorMessage: string | null;
  createdAt: string;
};

export const test = base.extend<Fixtures>({
  resetState: [
    async ({ context, request }, use) => {
      await resetE2eState(request, context);
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect };

export async function resetE2eState(
  request: APIRequestContext,
  context?: BrowserContext,
): Promise<void> {
  await context?.clearCookies();

  const response = await request.post(`${e2eApiUrl}/__e2e/reset`, {
    headers: { "x-e2e-reset-token": e2eResetToken },
  });

  if (!response.ok()) {
    throw new Error(`E2E reset failed: ${response.status()} ${await response.text()}`);
  }

  const fixtureResponse = await request.post(`${e2eResponsesUpstreamUrl}/__fixture/reset`);
  if (!fixtureResponse.ok()) {
    throw new Error(
      `Responses fixture reset failed: ${fixtureResponse.status()} ${await fixtureResponse.text()}`,
    );
  }
}

export async function seedE2e(request: APIRequestContext, input: SeedInput): Promise<SeedResponse> {
  const response = await request.post(`${e2eApiUrl}/__e2e/seed`, {
    headers: { "x-e2e-reset-token": e2eResetToken },
    data: input,
  });

  if (!response.ok()) {
    throw new Error(`E2E seed failed: ${response.status()} ${await response.text()}`);
  }

  return response.json();
}

export function bearerHeaders(rawKey: string): Record<string, string> {
  return { Authorization: `Bearer ${rawKey}` };
}

export async function postChatCompletion(
  request: APIRequestContext,
  rawKey: string,
  body: Record<string, unknown>,
): Promise<APIResponse> {
  return request.post(`${e2eApiUrl}/v1/chat/completions`, {
    headers: bearerHeaders(rawKey),
    data: body,
  });
}

export async function postResponse(
  request: APIRequestContext,
  rawKey: string,
  body: Record<string, unknown>,
): Promise<APIResponse> {
  return request.post(`${e2eApiUrl}/v1/responses`, {
    headers: bearerHeaders(rawKey),
    data: body,
  });
}

type ApiMethod = "GET" | "POST" | "PUT" | "DELETE";

export async function apiRequest(
  request: APIRequestContext,
  method: ApiMethod,
  path: string,
  options: { data?: unknown; headers?: Record<string, string> } = {},
): Promise<APIResponse> {
  return request.fetch(`${e2eApiUrl}${path}`, {
    method,
    headers: options.headers,
    data: options.data,
  });
}

export async function expectJsonStatus(
  response: APIResponse,
  status: number,
): Promise<Record<string, unknown>> {
  expect(response.status()).toBe(status);
  return (await response.json()) as Record<string, unknown>;
}

export async function readE2eRequestLogs(request: APIRequestContext): Promise<E2eRequestLog[]> {
  const response = await request.get(`${e2eApiUrl}/__e2e/request-logs`, {
    headers: { "x-e2e-reset-token": e2eResetToken },
  });

  if (!response.ok()) {
    throw new Error(`E2E request log read failed: ${response.status()} ${await response.text()}`);
  }

  const body = (await response.json()) as { requestLogs: E2eRequestLog[] };
  return body.requestLogs;
}

export async function waitForE2eRequestLog(
  request: APIRequestContext,
  predicate: (log: E2eRequestLog) => boolean,
): Promise<E2eRequestLog> {
  let match: E2eRequestLog | undefined;

  await expect
    .poll(async () => {
      const logs = await readE2eRequestLogs(request);
      match = logs.find(predicate);
      return Boolean(match);
    })
    .toBe(true);

  if (!match) {
    throw new Error("E2E request log did not match after polling");
  }

  return match;
}

export type E2eUpstreamRequest = {
  id: number;
  method: string;
  path: string;
  query: Record<string, string[]>;
  channel: string;
  authorizationPresent: boolean;
  apiKeyPresent: boolean;
  headerNames: string[];
  body: Record<string, unknown> | null;
};

export async function readResponsesUpstreamRequests(
  request: APIRequestContext,
): Promise<E2eUpstreamRequest[]> {
  const response = await request.get(`${e2eResponsesUpstreamUrl}/__fixture/requests`);
  if (!response.ok()) {
    throw new Error(
      `Responses fixture request read failed: ${response.status()} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { requests: E2eUpstreamRequest[] };
  return body.requests;
}

export async function waitForResponsesUpstreamRequest(
  request: APIRequestContext,
  predicate: (captured: E2eUpstreamRequest) => boolean,
): Promise<E2eUpstreamRequest> {
  let match: E2eUpstreamRequest | undefined;
  await expect
    .poll(async () => {
      match = (await readResponsesUpstreamRequests(request)).find(predicate);
      return Boolean(match);
    })
    .toBe(true);
  if (!match) throw new Error("Responses fixture request did not match after polling");
  return match;
}

export async function createAdminViaApi(
  request: APIRequestContext,
  user: AdminUser = adminUser,
): Promise<void> {
  const response = await request.post(`${e2eApiUrl}/auth/onboard`, {
    data: {
      email: user.email,
      name: user.name,
      password: user.password,
    },
  });

  expect(response.status()).toBe(201);
}

export async function onboardAdminViaUi(page: Page, user: AdminUser = adminUser): Promise<void> {
  await page.goto("/");

  await expect(page).toHaveURL(/\/onboard$/);
  await expect(page.getByText("Welcome to Mux Gateway")).toBeVisible();

  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Name (optional)").fill(user.name);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create admin account" }).click();

  await expect(page.getByRole("heading", { name: `Welcome, ${user.name}` })).toBeVisible();
  await expect(page.getByText(user.email)).toBeVisible();
}

export async function loginViaUi(page: Page, user: AdminUser = adminUser): Promise<void> {
  await page.goto("/login");

  await expect(page.getByText("Platform login")).toBeVisible();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByRole("heading", { name: `Welcome, ${user.name}` })).toBeVisible();
}

export async function createAndLoginAdmin(
  page: Page,
  request: APIRequestContext,
  user: AdminUser = adminUser,
): Promise<void> {
  await createAdminViaApi(request, user);
  await loginViaUi(page, user);
}

export async function getOpenAiModels(request: APIRequestContext, rawKey?: string) {
  return request.get(`${e2eApiUrl}/v1/models`, {
    headers: rawKey ? { Authorization: `Bearer ${rawKey}` } : undefined,
  });
}

export async function configureSyntheticProviderViaUi(page: Page): Promise<void> {
  await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "Providers" }).last()).toBeVisible();

  await page.getByPlaceholder(providerSearchPlaceholder).fill("synthetic");
  const row = syntheticProviderRow(page);
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Add key" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Add Synthetic key")).toBeVisible();
  await dialog.getByLabel("API key").fill(syntheticProviderKey);
  await dialog.getByRole("button", { name: "Save key" }).click();

  await expect(row.getByText("Configured")).toBeVisible();
  await expect(row.getByText(`**** ${syntheticProviderLastFour}`)).toBeVisible();
}

export async function removeSyntheticProviderViaUi(page: Page): Promise<void> {
  await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "Providers" }).last()).toBeVisible();

  await page.getByPlaceholder(providerSearchPlaceholder).fill("synthetic");
  const row = syntheticProviderRow(page);
  await expect(row.getByText("Configured")).toBeVisible();

  await row.getByLabel("Remove Synthetic key").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Remove Synthetic key?")).toBeVisible();
  await dialog.getByRole("button", { name: "Remove key" }).click();

  await expect(row.getByText("Needs key")).toBeVisible();
}

function syntheticProviderRow(page: Page) {
  return page.getByRole("row").filter({ hasText: "Synthetic" }).filter({ hasText: "synthetic" });
}
