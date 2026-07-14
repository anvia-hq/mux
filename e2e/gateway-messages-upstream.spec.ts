import {
  adminUser,
  expect,
  readResponsesUpstreamRequests,
  seedE2e,
  test,
  waitForE2eRequestLog,
  waitForResponsesUpstreamRequest,
} from "./fixtures";
import { e2eApiUrl } from "./env";

const model = "anthropic:claude-haiku-4-5";

async function seedMessages(
  request: Parameters<typeof seedE2e>[0],
  keyNames = ["messages-key"],
  spendLimits: Record<string, number> = {},
) {
  return seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    anthropicProvider: true,
    apiKeys: keyNames.map((name) => ({
      name,
      createdByEmail: adminUser.email,
      isActive: true,
      spendLimitUsd: spendLimits[name],
    })),
  });
}

async function postMessage(
  request: Parameters<typeof seedE2e>[0],
  rawKey: string,
  body: Record<string, unknown>,
) {
  return request.post(`${e2eApiUrl}/v1/messages?beta=true`, {
    headers: {
      "x-api-key": rawKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "tools-2024-04-04",
    },
    data: body,
  });
}

test("relays native Messages payloads and token counts over HTTP", async ({ request }) => {
  const seed = await seedMessages(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  const body = {
    model,
    max_tokens: 128,
    system: [{ type: "text", text: "Use tools when needed" }],
    messages: [{ role: "user", content: [{ type: "text", text: "Weather?" }] }],
    tools: [
      {
        name: "get_weather",
        description: "Get weather",
        input_schema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "get_weather" },
    thinking: { type: "enabled", budget_tokens: 64 },
    metadata: { user_id: "fixture-user" },
  };

  const response = await postMessage(request, rawKey, body);
  expect(response.status()).toBe(200);
  expect(response.headers()["x-fixture-upstream"]).toBe("anthropic-primary");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect(response.headers()["x-request-id"]).not.toBe("must-not-overwrite-gateway-request-id");
  await expect(response.json()).resolves.toMatchObject({
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: "Fixture Anthropic response" }],
    usage: { input_tokens: 12, output_tokens: 8 },
  });

  const captured = await waitForResponsesUpstreamRequest(
    request,
    (entry) => entry.path === "/v1/messages" && entry.method === "POST",
  );
  expect(captured.channel).toBe("anthropic-primary");
  expect(captured.apiKeyPresent).toBe(true);
  expect(captured.authorizationPresent).toBe(false);
  expect(captured.query).toEqual({ beta: ["true"] });
  expect(captured.headerNames).toEqual(
    expect.arrayContaining(["anthropic-beta", "anthropic-version", "x-api-key"]),
  );
  expect(captured.body).toMatchObject({
    ...body,
    model: "claude-haiku-4-5",
    stream: false,
  });

  const count = await request.post(`${e2eApiUrl}/v1/messages/count_tokens`, {
    headers: { "x-api-key": rawKey, "anthropic-version": "2023-06-01" },
    data: { model, messages: body.messages, system: body.system, tools: body.tools },
  });
  expect(count.status()).toBe(200);
  expect(count.headers()["x-fixture-upstream"]).toBe("anthropic-primary");
  await expect(count.json()).resolves.toEqual({ input_tokens: 42 });

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "messages-key" &&
      log.endpoint === "/v1/messages" &&
      log.statusCode === 200 &&
      log.totalTokens === 20,
  );
});

test("fails over only for configured Messages upstream statuses", async ({ request }) => {
  const seed = await seedMessages(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";

  const retried = await postMessage(request, rawKey, {
    model,
    max_tokens: 16,
    messages: [{ role: "user", content: "retry" }],
    metadata: { e2e_scenario: "retryable_primary" },
  });
  expect(retried.status()).toBe(200);
  expect(retried.headers()["x-fixture-upstream"]).toBe("anthropic-backup");

  const rejected = await postMessage(request, rawKey, {
    model,
    max_tokens: 16,
    messages: [{ role: "user", content: "reject" }],
    metadata: { e2e_scenario: "non_retryable" },
  });
  expect(rejected.status()).toBe(400);
  expect(rejected.headers()["retry-after"]).toBe("9");
  const rejectedText = await rejected.text();
  expect(rejectedText).toContain("request_id");
  expect(rejectedText).toContain("[REDACTED]");
  expect(rejectedText).not.toContain("sk-fixturesecret123456");

  const requests = await readResponsesUpstreamRequests(request);
  const retryAttempts = requests.filter(
    (entry) =>
      (entry.body?.metadata as Record<string, unknown> | undefined)?.e2e_scenario ===
      "retryable_primary",
  );
  expect(retryAttempts.map((entry) => entry.channel)).toEqual([
    "anthropic-primary",
    "anthropic-backup",
  ]);
  const rejectedAttempts = requests.filter(
    (entry) =>
      (entry.body?.metadata as Record<string, unknown> | undefined)?.e2e_scenario ===
      "non_retryable",
  );
  expect(rejectedAttempts).toHaveLength(1);
  expect(rejectedAttempts[0]?.channel).toBe("anthropic-primary");
});

test("handles fragmented Messages SSE and sanitizes terminal failures", async ({ request }) => {
  const seed = await seedMessages(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";

  const streamed = await postMessage(request, rawKey, {
    model,
    max_tokens: 32,
    messages: [{ role: "user", content: "fragment" }],
    stream: true,
    metadata: { e2e_scenario: "fragmented_stream" },
  });
  expect(streamed.status()).toBe(200);
  const streamedText = await streamed.text();
  expect(streamedText).toContain("event: content_block_delta");
  expect(streamedText).toContain("Fixture Anthropic stream");
  expect(streamedText).toContain("event: message_stop");

  const missing = await postMessage(request, rawKey, {
    model,
    max_tokens: 32,
    messages: [{ role: "user", content: "missing terminal" }],
    stream: true,
    metadata: { e2e_scenario: "missing_terminal" },
  });
  expect(missing.status()).toBe(200);
  expect(await missing.text()).toContain("event: error");

  const streamError = await postMessage(request, rawKey, {
    model,
    max_tokens: 32,
    messages: [{ role: "user", content: "stream error" }],
    stream: true,
    metadata: { e2e_scenario: "stream_error" },
  });
  const streamErrorText = await streamError.text();
  expect(streamErrorText).toContain("event: error");
  expect(streamErrorText).toContain("[REDACTED]");
  expect(streamErrorText).not.toContain("sk-streamsecret123456");

  const idle = await postMessage(request, rawKey, {
    model,
    max_tokens: 32,
    messages: [{ role: "user", content: "idle" }],
    stream: true,
    metadata: { e2e_scenario: "idle_timeout" },
  });
  expect(idle.status()).toBe(200);
  expect(await idle.text()).toContain("event: error");

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "messages-key" &&
      log.endpoint === "/v1/messages" &&
      log.statusCode === 502,
  );
});

test("returns a sanitized timeout after exhausting Messages channels", async ({ request }) => {
  const seed = await seedMessages(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  const response = await postMessage(request, rawKey, {
    model,
    max_tokens: 16,
    messages: [{ role: "user", content: "slow" }],
    metadata: { e2e_scenario: "slow_first_byte" },
  });

  expect(response.status()).toBe(504);
  await expect(response.json()).resolves.toMatchObject({
    type: "error",
    error: { type: "timeout_error", message: expect.stringContaining("request_id") },
    request_id: expect.any(String),
  });
});

test("settles Messages reservations and prevents concurrent overspend", async ({ request }) => {
  const seed = await seedMessages(request, ["settlement-key", "concurrent-key"], {
    "settlement-key": 0.00057,
    "concurrent-key": 0.00052,
  });
  const settlementKey = seed.apiKeys[0]?.rawKey ?? "";
  const concurrentKey = seed.apiKeys[1]?.rawKey ?? "";
  const body = {
    model,
    max_tokens: 1,
    messages: [{ role: "user", content: "bill usage" }],
  };

  expect((await postMessage(request, settlementKey, body)).status()).toBe(200);
  expect((await postMessage(request, settlementKey, body)).status()).toBe(200);
  expect((await postMessage(request, settlementKey, body)).status()).toBe(429);

  const concurrent = await Promise.all([
    postMessage(request, concurrentKey, body),
    postMessage(request, concurrentKey, body),
  ]);
  expect(concurrent.map((response) => response.status()).sort()).toEqual([200, 429]);
});
