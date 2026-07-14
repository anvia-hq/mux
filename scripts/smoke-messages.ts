const baseUrl = (process.env.MESSAGES_SMOKE_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const apiKey = process.env.MESSAGES_SMOKE_API_KEY?.trim();
const models = (process.env.MESSAGES_SMOKE_MODELS ?? "")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

if (!apiKey || models.length === 0) {
  throw new Error("MESSAGES_SMOKE_API_KEY and comma-separated MESSAGES_SMOKE_MODELS are required");
}

const headers = {
  "x-api-key": apiKey,
  "anthropic-version": "2023-06-01",
  "Content-Type": "application/json",
};

async function checked(response: Response, label: string): Promise<Response> {
  if (response.ok) return response;
  throw new Error(`${label} failed: ${response.status} ${await response.text()}`);
}

async function smokeModel(model: string) {
  const request = {
    model,
    max_tokens: 32,
    messages: [{ role: "user", content: "Reply with exactly: messages smoke ok" }],
  };
  const sync = await checked(
    await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    }),
    `${model} sync message`,
  );
  const syncBody = (await sync.json()) as { type?: string; content?: unknown[] };
  if (syncBody.type !== "message" || !Array.isArray(syncBody.content)) {
    throw new Error(`${model} sync message returned an unexpected payload`);
  }

  const stream = await checked(
    await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...request, stream: true }),
    }),
    `${model} stream message`,
  );
  if (!(await stream.text()).includes("message_stop")) {
    throw new Error(`${model} stream did not include message_stop`);
  }

  const count = await checked(
    await fetch(`${baseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    }),
    `${model} token count`,
  );
  const countBody = (await count.json()) as { input_tokens?: number };
  if (typeof countBody.input_tokens !== "number") {
    throw new Error(`${model} token count returned an unexpected payload`);
  }
}

for (const model of models) {
  await smokeModel(model);
  console.log(`Messages smoke passed for ${model}`);
}
