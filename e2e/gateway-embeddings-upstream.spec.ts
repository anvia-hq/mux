import {
  adminUser,
  bearerHeaders,
  expect,
  readResponsesUpstreamRequests,
  seedE2e,
  test,
  waitForE2eRequestLog,
  waitForResponsesUpstreamRequest,
} from "./fixtures";
import { e2eApiUrl, e2eResponsesUpstreamUrl } from "./env";

const provider = "embeddings-fixture";
const model = `${provider}:fixture-embed`;

function fixtureProvider() {
  return {
    id: provider,
    name: "Embeddings fixture",
    apiBase: `${e2eResponsesUpstreamUrl}/v1`,
    responsesMode: "via_chat" as const,
    models: [{ id: "fixture-embed", inputPricePer1M: 1, outputPricePer1M: 0 }],
    channels: [
      {
        id: "embeddings-primary",
        name: "Embeddings primary",
        apiKey: "fixture-embedding-primary-key",
        priority: 100,
      },
      {
        id: "embeddings-backup",
        name: "Embeddings backup",
        apiKey: "fixture-embedding-backup-key",
        priority: 50,
      },
    ],
  };
}

async function seedFixture(request: Parameters<typeof seedE2e>[0], spendLimitUsd?: number) {
  return seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    customProviders: [fixtureProvider()],
    apiKeys: [
      {
        name: "embeddings-key",
        createdByEmail: adminUser.email,
        isActive: true,
        spendLimitUsd,
      },
    ],
  });
}

async function postEmbedding(
  request: Parameters<typeof seedE2e>[0],
  rawKey: string,
  body: Record<string, unknown>,
) {
  return request.post(`${e2eApiUrl}/v1/embeddings`, {
    headers: bearerHeaders(rawKey),
    data: body,
  });
}

test("relays embedding fields, usage, status, and safe headers over HTTP", async ({ request }) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  const response = await postEmbedding(request, rawKey, {
    model,
    input: ["first input", "second input"],
    encoding_format: "float",
    dimensions: 256,
    user: "tenant-1",
    e2e_scenario: "success",
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["x-fixture-upstream"]).toBe("embedding-primary");
  expect(response.headers()["x-request-id"]).not.toBe("must-not-overwrite-gateway-request-id");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  await expect(response.json()).resolves.toMatchObject({
    object: "list",
    model,
    data: [
      { object: "embedding", embedding: [0.1, 0.2], index: 0 },
      { object: "embedding", embedding: [1.1, 1.2], index: 1 },
    ],
    usage: { prompt_tokens: 4, total_tokens: 4 },
  });

  const captured = await waitForResponsesUpstreamRequest(
    request,
    (entry) => entry.path === "/v1/embeddings",
  );
  expect(captured.channel).toBe("embedding-primary");
  expect(captured.body).toMatchObject({
    model: "fixture-embed",
    input: ["first input", "second input"],
    encoding_format: "float",
    dimensions: 256,
    user: "tenant-1",
    e2e_scenario: "success",
  });

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "embeddings-key" &&
      log.endpoint === "/v1/embeddings" &&
      log.channelId === "embeddings-primary" &&
      log.totalTokens === 4,
  );
});

test("supports base64 output and the legacy engines route", async ({ request }) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  const response = await request.post(`${e2eApiUrl}/v1/engines/${model}/embeddings`, {
    headers: bearerHeaders(rawKey),
    data: { input: "legacy input", encoding_format: "base64" },
  });

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    model,
    data: [{ object: "embedding", embedding: expect.any(String), index: 0 }],
  });
  const captured = await waitForResponsesUpstreamRequest(
    request,
    (entry) => entry.path === "/v1/embeddings",
  );
  expect(captured.body).toMatchObject({
    model: "fixture-embed",
    input: "legacy input",
    encoding_format: "base64",
  });
});

test("fails over retryable statuses and preserves terminal upstream errors", async ({
  request,
}) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";

  const retried = await postEmbedding(request, rawKey, {
    model,
    input: "retry embedding",
    e2e_scenario: "retryable_primary",
  });
  expect(retried.status()).toBe(200);
  expect(retried.headers()["x-fixture-upstream"]).toBe("embedding-backup");
  const retryAttempts = (await readResponsesUpstreamRequests(request)).filter(
    (entry) => entry.path === "/v1/embeddings" && entry.body?.e2e_scenario === "retryable_primary",
  );
  expect(retryAttempts.map((entry) => entry.channel)).toEqual([
    "embedding-primary",
    "embedding-backup",
  ]);

  const rejected = await postEmbedding(request, rawKey, {
    model,
    input: "reject embedding",
    e2e_scenario: "non_retryable",
  });
  expect(rejected.status()).toBe(400);
  expect(rejected.headers()["retry-after"]).toBe("9");
  const rejectedText = await rejected.text();
  expect(rejectedText).toContain("[REDACTED]");
  expect(rejectedText).toContain("request_id");
  expect(rejectedText).not.toContain("sk-fixturesecret123456");
  const terminalAttempts = (await readResponsesUpstreamRequests(request)).filter(
    (entry) => entry.path === "/v1/embeddings" && entry.body?.e2e_scenario === "non_retryable",
  );
  expect(terminalAttempts).toHaveLength(1);
  expect(terminalAttempts[0]?.channel).toBe("embedding-primary");
});

test("returns sanitized protocol and timeout failures after exhausting channels", async ({
  request,
}) => {
  const seed = await seedFixture(request);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";

  const malformed = await postEmbedding(request, rawKey, {
    model,
    input: "bad response",
    e2e_scenario: "malformed",
  });
  expect(malformed.status()).toBe(502);
  await expect(malformed.json()).resolves.toMatchObject({
    error: { type: "upstream_error", code: "upstream_request_failed" },
  });

  const slow = await postEmbedding(request, rawKey, {
    model,
    input: "slow response",
    e2e_scenario: "slow",
  });
  expect(slow.status()).toBe(504);
  await expect(slow.json()).resolves.toMatchObject({
    error: { type: "timeout_error", code: "upstream_timeout" },
  });
  const slowAttempts = (await readResponsesUpstreamRequests(request)).filter(
    (entry) => entry.path === "/v1/embeddings" && entry.body?.e2e_scenario === "slow",
  );
  expect(slowAttempts.map((entry) => entry.channel)).toEqual([
    "embedding-primary",
    "embedding-backup",
  ]);
});

test("reserves limited spend atomically across concurrent requests", async ({ request }) => {
  const seed = await seedFixture(request, 0.000006);
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  const body = { model, input: [1, 2, 3, 4] };
  const responses = await Promise.all([
    postEmbedding(request, rawKey, body),
    postEmbedding(request, rawKey, body),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 429]);
});
