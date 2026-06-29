import {
  adminUser,
  bearerHeaders,
  e2eBackupModel,
  e2eChatModel,
  e2eFailModel,
  e2eUnbillableModel,
  expect,
  loginViaUi,
  postChatCompletion,
  seedE2e,
  test,
  waitForE2eRequestLog,
} from "./fixtures";
import { e2eApiUrl } from "./env";

test("serves chat completions and renders gateway logs in the dashboard", async ({
  page,
  request,
}) => {
  const seed = await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    apiKeys: [{ name: "chat-key", createdByEmail: adminUser.email, isActive: true }],
  });
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  expect(rawKey).not.toBe("");

  const response = await postChatCompletion(request, rawKey, {
    model: e2eChatModel,
    messages: [{ role: "user", content: "hello chat" }],
  });

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.model).toBe(e2eChatModel);
  expect(body.choices[0].message.content).toContain("hello chat");
  expect(body.usage.total_tokens).toBe(18);

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "chat-key" &&
      log.provider === "e2e" &&
      log.model === e2eChatModel &&
      log.endpoint === "/v1/chat/completions" &&
      log.statusCode === 200 &&
      log.totalTokens === 18,
  );

  await loginViaUi(page, adminUser);
  await page.goto("/logs");
  await expect(page.getByRole("heading", { name: "Request logs" })).toBeVisible();
  await expect(page.getByText("chat-key")).toBeVisible();
  await expect(page.getByRole("cell", { name: "e2e", exact: true })).toBeVisible();
  await expect(page.getByText(e2eChatModel)).toBeVisible();
});

test("streams chat completions and finalizes streamed request logs", async ({ request }) => {
  const seed = await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    apiKeys: [{ name: "stream-key", createdByEmail: adminUser.email, isActive: true }],
  });
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  expect(rawKey).not.toBe("");

  const response = await postChatCompletion(request, rawKey, {
    model: e2eChatModel,
    messages: [{ role: "user", content: "hello stream" }],
    stream: true,
  });

  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toContain("data:");
  expect(text).toContain("E2E stream for hello stream");
  expect(text).toContain("data: [DONE]");

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "stream-key" &&
      log.model === e2eChatModel &&
      log.statusCode === 200 &&
      log.promptTokens === 11 &&
      log.completionTokens === 7,
  );
});

test("retries fallback groups after a provider failure", async ({ request }) => {
  const seed = await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    apiKeys: [{ name: "fallback-key", createdByEmail: adminUser.email, isActive: true }],
    fallbackGroups: [
      {
        id: "e2e-fallback",
        name: "E2E Fallback",
        targets: [
          { provider: "e2e", modelId: "e2e-fail" },
          { provider: "e2e", modelId: "e2e-backup" },
        ],
      },
    ],
  });
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  expect(rawKey).not.toBe("");

  const response = await postChatCompletion(request, rawKey, {
    model: "mux:e2e-fallback",
    messages: [{ role: "user", content: "fallback please" }],
  });

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.model).toBe("mux:e2e-fallback");
  expect(body.choices[0].message.content).toContain("fallback please");

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "fallback-key" &&
      log.model === e2eFailModel &&
      log.statusCode === 500 &&
      log.errorMessage?.includes("forced failure") === true,
  );
  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "fallback-key" && log.model === e2eBackupModel && log.statusCode === 200,
  );
});

test("enforces spend limits and rejects unbillable limited chat usage", async ({ request }) => {
  const seed = await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    apiKeys: [
      {
        name: "limited-key",
        createdByEmail: adminUser.email,
        spendLimitUsd: 0.00002,
        isActive: true,
      },
      {
        name: "unbillable-key",
        createdByEmail: adminUser.email,
        spendLimitUsd: 1,
        isActive: true,
      },
    ],
  });
  const limitedKey = seed.apiKeys.find((key) => key.name === "limited-key")?.rawKey ?? "";
  const unbillableKey = seed.apiKeys.find((key) => key.name === "unbillable-key")?.rawKey ?? "";
  expect(limitedKey).not.toBe("");
  expect(unbillableKey).not.toBe("");

  const first = await postChatCompletion(request, limitedKey, {
    model: e2eChatModel,
    messages: [{ role: "user", content: "bill me" }],
  });
  expect(first.status()).toBe(200);

  const second = await postChatCompletion(request, limitedKey, {
    model: e2eChatModel,
    messages: [{ role: "user", content: "bill me again" }],
  });
  expect(second.status()).toBe(429);
  await expect(second.json()).resolves.toMatchObject({ error: "API key spend limit exceeded" });

  const streaming = await postChatCompletion(request, limitedKey, {
    model: e2eChatModel,
    messages: [{ role: "user", content: "stream blocked" }],
    stream: true,
  });
  expect(streaming.status()).toBe(429);
  await expect(streaming.json()).resolves.toMatchObject({
    error: "streaming is not supported for API keys with a spend limit",
  });

  const unbillable = await postChatCompletion(request, unbillableKey, {
    model: e2eUnbillableModel,
    messages: [{ role: "user", content: "no usage" }],
  });
  expect(unbillable.status()).toBe(429);
  const unbillableBody = await unbillable.json();
  expect(unbillableBody.error).toContain("billable usage");

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "unbillable-key" &&
      log.model === e2eUnbillableModel &&
      log.statusCode === 429,
  );
});

test("rejects unsupported chat features before calling the provider", async ({ request }) => {
  const seed = await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    apiKeys: [{ name: "feature-key", createdByEmail: adminUser.email, isActive: true }],
  });
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  expect(rawKey).not.toBe("");

  const response = await request.post(`${e2eApiUrl}/v1/chat/completions`, {
    headers: bearerHeaders(rawKey),
    data: {
      model: "e2e:e2e-unsupported",
      messages: [{ role: "user", content: "use a tool" }],
      tools: [
        {
          type: "function",
          function: { name: "lookup" },
        },
      ],
    },
  });

  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(body.error).toContain("does not support requested feature");
});
