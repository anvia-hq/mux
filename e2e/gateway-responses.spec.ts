import {
  adminUser,
  bearerHeaders,
  e2eResponsesModel,
  expect,
  postResponse,
  seedE2e,
  test,
  waitForE2eRequestLog,
} from "./fixtures";
import { e2eApiUrl } from "./env";

test("creates and streams OpenAI-compatible Responses API calls", async ({ request }) => {
  const seed = await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    apiKeys: [{ name: "responses-key", createdByEmail: adminUser.email, isActive: true }],
  });
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  expect(rawKey).not.toBe("");

  const create = await postResponse(request, rawKey, {
    model: e2eResponsesModel,
    input: "hello response",
  });
  expect(create.status()).toBe(200);
  const createBody = await create.json();
  expect(createBody.model).toBe(e2eResponsesModel);
  expect(createBody.status).toBe("completed");
  expect(createBody.output[0].content[0].text).toContain("hello response");
  expect(createBody.usage.total_tokens).toBe(20);

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "responses-key" &&
      log.model === e2eResponsesModel &&
      log.endpoint === "/v1/responses" &&
      log.statusCode === 200 &&
      log.totalTokens === 20,
  );

  const stream = await postResponse(request, rawKey, {
    model: e2eResponsesModel,
    input: "stream response",
    stream: true,
  });
  expect(stream.status()).toBe(200);
  const streamText = await stream.text();
  expect(streamText).toContain("event: response.output_text.delta");
  expect(streamText).toContain("E2E stream for stream response");
  expect(streamText).toContain("event: response.completed");

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "responses-key" &&
      log.model === e2eResponsesModel &&
      log.endpoint === "/v1/responses" &&
      log.statusCode === 200 &&
      log.promptTokens === 12 &&
      log.completionTokens === 8,
  );
});

test("tracks background responses through retrieve, cancel, and delete", async ({ request }) => {
  const seed = await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    apiKeys: [{ name: "background-key", createdByEmail: adminUser.email, isActive: true }],
  });
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  expect(rawKey).not.toBe("");

  const create = await postResponse(request, rawKey, {
    model: e2eResponsesModel,
    input: "background response",
    background: true,
  });
  expect(create.status()).toBe(202);
  expect(create.headers().location).toMatch(/^\/v1\/responses\//);
  const createBody = await create.json();
  expect(createBody.model).toBe(e2eResponsesModel);
  expect(createBody.status).toBe("queued");
  const id = createBody.id as string;

  const retrievePending = await request.get(`${e2eApiUrl}/v1/responses/${id}`, {
    headers: bearerHeaders(rawKey),
  });
  expect(retrievePending.status()).toBe(202);
  await expect(retrievePending.json()).resolves.toMatchObject({ id, status: "queued" });

  const cancel = await request.post(`${e2eApiUrl}/v1/responses/${id}/cancel`, {
    headers: bearerHeaders(rawKey),
  });
  expect(cancel.status()).toBe(200);
  await expect(cancel.json()).resolves.toMatchObject({ id, status: "cancelled" });

  const retrieveCancelled = await request.get(`${e2eApiUrl}/v1/responses/${id}`, {
    headers: bearerHeaders(rawKey),
  });
  expect(retrieveCancelled.status()).toBe(200);
  await expect(retrieveCancelled.json()).resolves.toMatchObject({ id, status: "cancelled" });

  const deleted = await request.delete(`${e2eApiUrl}/v1/responses/${id}`, {
    headers: bearerHeaders(rawKey),
  });
  expect(deleted.status()).toBe(200);
  await expect(deleted.json()).resolves.toMatchObject({ id, deleted: true });

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "background-key" &&
      log.endpoint === "/v1/responses" &&
      log.statusCode === 202,
  );
  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "background-key" &&
      log.endpoint === "/v1/responses/:id/cancel" &&
      log.statusCode === 200,
  );
});

test("covers response utility endpoints without a real OpenAI provider", async ({ request }) => {
  const seed = await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    apiKeys: [{ name: "response-utils-key", createdByEmail: adminUser.email, isActive: true }],
  });
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  expect(rawKey).not.toBe("");

  const inputTokens = await request.post(`${e2eApiUrl}/v1/responses/input_tokens`, {
    headers: bearerHeaders(rawKey),
    data: {
      model: e2eResponsesModel,
      input: "count tokens",
    },
  });
  expect(inputTokens.status()).toBe(200);
  await expect(inputTokens.json()).resolves.toMatchObject({
    input_tokens: 42,
    usage: { total_tokens: 42 },
  });

  const inputItems = await request.get(`${e2eApiUrl}/v1/responses/resp_e2e_any/input_items`, {
    headers: bearerHeaders(rawKey),
  });
  expect(inputItems.status()).toBe(200);
  const inputItemsBody = await inputItems.json();
  expect(inputItemsBody.object).toBe("list");
  expect(inputItemsBody.data[0].content[0].text).toBe("E2E input item");

  const retrieve = await request.get(`${e2eApiUrl}/v1/responses/resp_e2e_remote`, {
    headers: bearerHeaders(rawKey),
  });
  expect(retrieve.status()).toBe(200);
  await expect(retrieve.json()).resolves.toMatchObject({
    id: "resp_e2e_remote",
    status: "completed",
  });

  const cancel = await request.post(`${e2eApiUrl}/v1/responses/resp_e2e_cancel/cancel`, {
    headers: bearerHeaders(rawKey),
  });
  expect(cancel.status()).toBe(200);
  await expect(cancel.json()).resolves.toMatchObject({
    id: "resp_e2e_cancel",
    status: "cancelled",
  });

  const deleted = await request.delete(`${e2eApiUrl}/v1/responses/resp_e2e_remote`, {
    headers: bearerHeaders(rawKey),
  });
  expect(deleted.status()).toBe(200);
  await expect(deleted.json()).resolves.toMatchObject({
    id: "resp_e2e_remote",
    deleted: true,
  });

  const compact = await request.post(`${e2eApiUrl}/v1/responses/compact`, {
    headers: bearerHeaders(rawKey),
    data: {
      model: e2eResponsesModel,
      input: "summarize the thread",
    },
  });
  expect(compact.status()).toBe(200);
  const compactBody = await compact.json();
  expect(compactBody.status).toBe("completed");
  expect(compactBody.output[0].content[0].text).toBe("E2E compacted context");

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "response-utils-key" &&
      log.endpoint === "/v1/responses/compact" &&
      log.statusCode === 200,
  );
});
