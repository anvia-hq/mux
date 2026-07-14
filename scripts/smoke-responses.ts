const baseUrl = (process.env.RESPONSES_SMOKE_BASE_URL ?? "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);
const apiKey = process.env.RESPONSES_SMOKE_API_KEY?.trim();
const models = (process.env.RESPONSES_SMOKE_MODELS ?? "")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const background = process.env.RESPONSES_SMOKE_BACKGROUND === "1";

if (!apiKey || models.length === 0) {
  throw new Error(
    "RESPONSES_SMOKE_API_KEY and comma-separated RESPONSES_SMOKE_MODELS are required",
  );
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};

async function checked(response: Response, label: string): Promise<Response> {
  if (response.ok) return response;
  throw new Error(`${label} failed: ${response.status} ${await response.text()}`);
}

async function smokeModel(model: string) {
  const sync = await checked(
    await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input: "Reply with exactly: responses smoke ok" }),
    }),
    `${model} sync response`,
  );
  const syncBody = (await sync.json()) as { status?: string; output?: unknown[] };
  if (syncBody.status !== "completed" || !Array.isArray(syncBody.output)) {
    throw new Error(`${model} sync response returned an unexpected payload`);
  }

  const stream = await checked(
    await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: "Reply with exactly: responses stream ok",
        stream: true,
      }),
    }),
    `${model} stream response`,
  );
  const streamBody = await stream.text();
  if (!streamBody.includes("response.completed") && !streamBody.includes("response.incomplete")) {
    throw new Error(`${model} stream did not include a terminal Responses event`);
  }

  if (!background) return;
  const submitted = await checked(
    await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input: "Reply with: background smoke ok", background: true }),
    }),
    `${model} background submission`,
  );
  const submittedBody = (await submitted.json()) as { id?: string; status?: string };
  if (!submittedBody.id) throw new Error(`${model} background submission did not return an id`);

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const retrieved = await checked(
      await fetch(`${baseUrl}/v1/responses/${encodeURIComponent(submittedBody.id)}`, { headers }),
      `${model} background retrieval`,
    );
    const body = (await retrieved.json()) as { status?: string };
    if (body.status === "completed") return;
    if (body.status === "failed" || body.status === "cancelled") {
      throw new Error(`${model} background response ended with status ${body.status}`);
    }
  }
  throw new Error(`${model} background response did not complete within 120 seconds`);
}

for (const model of models) {
  await smokeModel(model);
  console.log(`Responses smoke passed for ${model}`);
}
