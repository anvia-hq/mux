import {
  adminUser,
  bearerHeaders,
  expect,
  postResponse,
  readResponsesUpstreamRequests,
  seedE2e,
  test,
  waitForE2eRequestLog,
  waitForResponsesUpstreamRequest,
} from "./fixtures";
import { e2eApiUrl, e2eResponsesUpstreamUrl } from "./env";

const nativeProvider = "responses-native-fixture";
const nativeModel = `${nativeProvider}:fixture-native`;
const chatProvider = "responses-chat-fixture";
const chatModel = `${chatProvider}:fixture-chat`;

function fixtureProviders() {
  return [
    {
      id: nativeProvider,
      name: "Responses native fixture",
      apiBase: `${e2eResponsesUpstreamUrl}/v1`,
      responsesMode: "native" as const,
      responsesEndpoint: `${e2eResponsesUpstreamUrl}/v1/responses?api-version=e2e`,
      models: [{ id: "fixture-native", inputPricePer1M: 1, outputPricePer1M: 2 }],
      channels: [
        {
          id: "responses-native-primary",
          name: "Native primary",
          apiKey: "fixture-native-primary-key",
          priority: 100,
        },
        {
          id: "responses-native-backup",
          name: "Native backup",
          apiKey: "fixture-native-backup-key",
          priority: 50,
        },
      ],
    },
    {
      id: chatProvider,
      name: "Responses chat fixture",
      apiBase: `${e2eResponsesUpstreamUrl}/v1`,
      responsesMode: "via_chat" as const,
      models: [{ id: "fixture-chat", inputPricePer1M: 1, outputPricePer1M: 2 }],
      channels: [
        {
          id: "responses-chat-primary",
          name: "Chat primary",
          apiKey: "fixture-chat-primary-key",
          priority: 100,
        },
        {
          id: "responses-chat-backup",
          name: "Chat backup",
          apiKey: "fixture-chat-backup-key",
          priority: 50,
        },
      ],
    },
  ];
}

async function seedFixture(
  request: Parameters<typeof seedE2e>[0],
  keyNames = ["fixture-key"],
  spendLimits: Record<string, number> = {},
) {
  return seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    customProviders: fixtureProviders(),
    apiKeys: keyNames.map((name) => ({
      name,
      createdByEmail: adminUser.email,
      isActive: true,
      spendLimitUsd: spendLimits[name],
    })),
  });
}

test("relays native Responses requests over HTTP and preserves the configured endpoint", async ({
  request,
}) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";

  const response = await postResponse(request, rawKey, {
    model: nativeModel,
    input: "native fixture input",
    metadata: { tenant: "e2e" },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["x-fixture-upstream"]).toBe("native-primary");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect(response.headers()["x-request-id"]).not.toBe("must-not-overwrite-gateway-request-id");
  await expect(response.json()).resolves.toMatchObject({
    object: "response",
    status: "completed",
    model: nativeModel,
    usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
  });

  const captured = await waitForResponsesUpstreamRequest(
    request,
    (entry) => entry.path === "/v1/responses" && entry.method === "POST",
  );
  expect(captured.channel).toBe("native-primary");
  expect(captured.authorizationPresent).toBe(true);
  expect(captured.query).toEqual({ "api-version": ["e2e"] });
  expect(captured.body).toMatchObject({
    model: "fixture-native",
    input: "native fixture input",
    metadata: { tenant: "e2e" },
  });

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "fixture-key" &&
      log.endpoint === "/v1/responses" &&
      log.channelId === "responses-native-primary" &&
      log.totalTokens === 20,
  );
});

test("fails over only for retryable native upstream failures", async ({ request }) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";

  const retried = await postResponse(request, rawKey, {
    model: nativeModel,
    input: "retry me",
    metadata: { e2e_scenario: "retryable_primary" },
  });
  expect(retried.status()).toBe(200);
  expect(retried.headers()["x-fixture-upstream"]).toBe("native-backup");

  const retryRequests = (await readResponsesUpstreamRequests(request)).filter(
    (entry) => entry.body?.metadata && entry.path === "/v1/responses",
  );
  expect(retryRequests.map((entry) => entry.channel)).toEqual(["native-primary", "native-backup"]);

  const rejected = await postResponse(request, rawKey, {
    model: nativeModel,
    input: "do not retry",
    metadata: { e2e_scenario: "non_retryable" },
  });
  expect(rejected.status()).toBe(400);
  expect(rejected.headers()["retry-after"]).toBe("9");
  const rejectedBody = await rejected.text();
  expect(rejectedBody).toContain("request_id");
  expect(rejectedBody).toContain("[REDACTED]");
  expect(rejectedBody).not.toContain("sk-fixturesecret123456");

  const all = await readResponsesUpstreamRequests(request);
  const nonRetryable = all.filter(
    (entry) =>
      (entry.body?.metadata as Record<string, unknown> | undefined)?.e2e_scenario ===
      "non_retryable",
  );
  expect(nonRetryable).toHaveLength(1);
  expect(nonRetryable[0]?.channel).toBe("native-primary");
});

test("handles fragmented native SSE and surfaces terminal protocol failures", async ({
  request,
}) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";

  const streamed = await postResponse(request, rawKey, {
    model: nativeModel,
    input: "fragment the stream",
    stream: true,
    metadata: { e2e_scenario: "fragmented_stream" },
  });
  expect(streamed.status()).toBe(200);
  const streamedText = await streamed.text();
  expect(streamedText).toContain("event: response.output_text.delta");
  expect(streamedText).toContain("Fixture streamed response");
  expect(streamedText).toContain("event: response.completed");

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "fixture-key" &&
      log.endpoint === "/v1/responses" &&
      log.statusCode === 200 &&
      log.totalTokens === 20,
  );

  const missingTerminal = await postResponse(request, rawKey, {
    model: nativeModel,
    input: "omit terminal",
    stream: true,
    metadata: { e2e_scenario: "missing_terminal" },
  });
  expect(missingTerminal.status()).toBe(200);
  const failureText = await missingTerminal.text();
  expect(failureText).toContain("event: error");
  expect(failureText).toContain("upstream_request_failed");

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "fixture-key" &&
      log.endpoint === "/v1/responses" &&
      log.statusCode === 502,
  );

  const idle = await postResponse(request, rawKey, {
    model: nativeModel,
    input: "stall the stream",
    stream: true,
    metadata: { e2e_scenario: "idle_timeout" },
  });
  expect(idle.status()).toBe(200);
  expect(await idle.text()).toContain("event: error");
});

test("returns a sanitized timeout after exhausting native channels", async ({ request }) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";

  const response = await postResponse(request, rawKey, {
    model: nativeModel,
    input: "delay all channels",
    metadata: { e2e_scenario: "slow_first_byte" },
  });
  expect(response.status()).toBe(504);
  await expect(response.json()).resolves.toMatchObject({
    error: { type: "timeout_error", code: "upstream_timeout" },
  });

  const attempts = (await readResponsesUpstreamRequests(request)).filter(
    (entry) =>
      (entry.body?.metadata as Record<string, unknown> | undefined)?.e2e_scenario ===
      "slow_first_byte",
  );
  expect(attempts.map((entry) => entry.channel)).toEqual(["native-primary", "native-backup"]);
});

test("aborts the upstream stream and records a client disconnect", async ({ request }) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  const controller = new AbortController();
  const response = await fetch(`${e2eApiUrl}/v1/responses`, {
    method: "POST",
    headers: { ...bearerHeaders(rawKey), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: nativeModel,
      input: "disconnect downstream",
      stream: true,
      metadata: { e2e_scenario: "idle_timeout" },
    }),
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  await reader?.read();
  controller.abort();
  await reader?.cancel().catch(() => undefined);

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "fixture-key" &&
      log.endpoint === "/v1/responses" &&
      log.statusCode === 499,
  );
});

test("converts Responses requests and streams through chat completions", async ({ request }) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";

  const structured = await postResponse(request, rawKey, {
    model: chatModel,
    instructions: "Return JSON",
    input: "Give an answer",
    text: {
      format: {
        type: "json_schema",
        name: "answer",
        strict: true,
        schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
          additionalProperties: false,
        },
      },
    },
    metadata: { e2e_scenario: "structured_output" },
  });
  expect(structured.status()).toBe(200);
  await expect(structured.json()).resolves.toMatchObject({
    object: "response",
    status: "completed",
    model: chatModel,
    output: [{ type: "message", content: [{ text: JSON.stringify({ answer: "fixture" }) }] }],
    usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
  });

  const converted = await waitForResponsesUpstreamRequest(
    request,
    (entry) => entry.path === "/v1/chat/completions" && entry.body?.stream !== true,
  );
  expect(converted.body).toMatchObject({
    model: "fixture-chat",
    messages: [
      { role: "system", content: "Return JSON" },
      { role: "user", content: "Give an answer" },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "answer", strict: true },
    },
  });

  const toolCall = await postResponse(request, rawKey, {
    model: chatModel,
    input: "Weather?",
    tools: [
      {
        type: "function",
        name: "get_weather",
        description: "Get weather",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
        strict: true,
      },
    ],
    tool_choice: { type: "function", name: "get_weather" },
    metadata: { e2e_scenario: "tool_call" },
  });
  expect(toolCall.status()).toBe(200);
  await expect(toolCall.json()).resolves.toMatchObject({
    output: [
      {
        type: "function_call",
        call_id: "call_fixture_weather",
        name: "get_weather",
      },
    ],
  });

  const stream = await postResponse(request, rawKey, {
    model: chatModel,
    input: "Stream through chat",
    stream: true,
  });
  expect(stream.status()).toBe(200);
  const streamText = await stream.text();
  expect(streamText).toContain("event: response.reasoning_summary_text.delta");
  expect(streamText).toContain("event: response.output_text.delta");
  expect(streamText).toContain("Fixture chat stream");
  expect(streamText).toContain("event: response.completed");
});

test("rejects stateful chat-converted fields without calling upstream", async ({ request }) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  const before = await readResponsesUpstreamRequests(request);

  const response = await postResponse(request, rawKey, {
    model: chatModel,
    input: "continue",
    previous_response_id: "resp_previous",
  });
  expect(response.status()).toBe(422);
  expect(await response.text()).toContain("previous_response_id");

  expect(await readResponsesUpstreamRequests(request)).toHaveLength(before.length);
});

test("relays native Responses utility operations", async ({ request }) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";

  const inputTokens = await request.post(`${e2eApiUrl}/v1/responses/input_tokens`, {
    headers: bearerHeaders(rawKey),
    data: { model: nativeModel, input: "count fixture tokens" },
  });
  expect(inputTokens.status()).toBe(200);
  await expect(inputTokens.json()).resolves.toMatchObject({ input_tokens: 42 });

  const compact = await request.post(`${e2eApiUrl}/v1/responses/compact`, {
    headers: bearerHeaders(rawKey),
    data: { model: nativeModel, input: "compact fixture context" },
  });
  expect(compact.status()).toBe(200);
  await expect(compact.json()).resolves.toMatchObject({
    model: nativeModel,
    status: "completed",
    output: [{ content: [{ text: "Fixture compacted context" }] }],
  });

  const inputItems = await request.get(
    `${e2eApiUrl}/v1/responses/resp_remote_fixture/input_items?limit=1`,
    { headers: bearerHeaders(rawKey) },
  );
  expect(inputItems.status()).toBe(200);
  await expect(inputItems.json()).resolves.toMatchObject({
    object: "list",
    data: [{ content: [{ text: "Fixture input item" }] }],
  });

  const captured = await readResponsesUpstreamRequests(request);
  expect(
    captured.some(
      (entry) =>
        entry.path === "/v1/responses/input_tokens" && entry.query["api-version"]?.[0] === "e2e",
    ),
  ).toBe(true);
  expect(
    captured.some(
      (entry) =>
        entry.path === "/v1/responses/resp_remote_fixture/input_items" &&
        entry.query.limit?.[0] === "1" &&
        entry.query["api-version"]?.[0] === "e2e",
    ),
  ).toBe(true);
});

test("settles spend reservations and prevents concurrent overspend", async ({ request }) => {
  const seed = await seedFixture(request, ["settlement-key", "concurrent-key"], {
    "settlement-key": 0.00055,
    "concurrent-key": 0.00052,
  });
  const settlementKey = seed.apiKeys[0]?.rawKey ?? "";
  const concurrentKey = seed.apiKeys[1]?.rawKey ?? "";
  const body = {
    model: nativeModel,
    input: "bill fixture usage",
    max_output_tokens: 1,
  };

  expect((await postResponse(request, settlementKey, body)).status()).toBe(200);
  expect((await postResponse(request, settlementKey, body)).status()).toBe(200);
  expect((await postResponse(request, settlementKey, body)).status()).toBe(429);

  const concurrent = await Promise.all([
    postResponse(request, concurrentKey, body),
    postResponse(request, concurrentKey, body),
  ]);
  expect(concurrent.map((response) => response.status()).sort()).toEqual([200, 429]);
});

test("completes background responses through the real worker and isolates ownership", async ({
  request,
}) => {
  const seed = await seedFixture(request, ["background-owner", "background-other"], {
    "background-owner": 0.00055,
  });
  const ownerKey = seed.apiKeys[0]?.rawKey ?? "";
  const otherKey = seed.apiKeys[1]?.rawKey ?? "";

  const create = await postResponse(request, ownerKey, {
    model: nativeModel,
    input: "background fixture",
    background: true,
    max_output_tokens: 1,
  });
  expect(create.status()).toBe(202);
  const created = (await create.json()) as { id: string; status: string };
  expect(created.status).toBe("queued");

  const forbidden = await request.get(`${e2eApiUrl}/v1/responses/${created.id}`, {
    headers: bearerHeaders(otherKey),
  });
  expect(forbidden.status()).toBe(404);
  const forbiddenItems = await request.get(`${e2eApiUrl}/v1/responses/${created.id}/input_items`, {
    headers: bearerHeaders(otherKey),
  });
  expect(forbiddenItems.status()).toBe(404);

  let completedBody: Record<string, unknown> | undefined;
  await expect
    .poll(
      async () => {
        const retrieve = await request.get(`${e2eApiUrl}/v1/responses/${created.id}`, {
          headers: bearerHeaders(ownerKey),
        });
        completedBody = (await retrieve.json()) as Record<string, unknown>;
        return completedBody.status;
      },
      { timeout: 12_000 },
    )
    .toBe("completed");
  expect(completedBody).toMatchObject({
    id: created.id,
    model: nativeModel,
    output: [{ content: [{ text: "Fixture background completed" }] }],
  });

  const poll = await waitForResponsesUpstreamRequest(
    request,
    (entry) => entry.method === "GET" && entry.path.endsWith(`/${created.id}`),
  );
  expect(poll.channel).toBe("native-primary");
  expect(poll.query).toEqual({ "api-version": ["e2e"] });

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "background-owner" &&
      log.endpoint === "/v1/responses" &&
      log.statusCode === 200 &&
      log.totalTokens === 20,
  );

  const afterSettlement = await postResponse(request, ownerKey, {
    model: nativeModel,
    input: "reservation should be settled",
    max_output_tokens: 1,
  });
  expect(afterSettlement.status()).toBe(200);

  const cancelCreate = await postResponse(request, otherKey, {
    model: nativeModel,
    input: "cancel fixture",
    background: true,
  });
  expect(cancelCreate.status()).toBe(202);
  const cancellable = (await cancelCreate.json()) as { id: string };
  const cancelled = await request.post(`${e2eApiUrl}/v1/responses/${cancellable.id}/cancel`, {
    headers: bearerHeaders(otherKey),
  });
  expect(cancelled.status()).toBe(200);
  await expect(cancelled.json()).resolves.toMatchObject({
    id: cancellable.id,
    status: "cancelled",
  });
  await waitForResponsesUpstreamRequest(
    request,
    (entry) => entry.method === "POST" && entry.path.endsWith(`/${cancellable.id}/cancel`),
  );

  const deleted = await request.delete(`${e2eApiUrl}/v1/responses/${created.id}`, {
    headers: bearerHeaders(ownerKey),
  });
  expect(deleted.status()).toBe(200);
  await expect(deleted.json()).resolves.toMatchObject({ id: created.id, deleted: true });
});
