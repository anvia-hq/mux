const baseUrl = (process.env.EMBEDDINGS_SMOKE_BASE_URL ?? "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);
const apiKey = process.env.EMBEDDINGS_SMOKE_API_KEY?.trim();
const models = (process.env.EMBEDDINGS_SMOKE_MODELS ?? "")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

if (!apiKey || models.length === 0) {
  throw new Error(
    "EMBEDDINGS_SMOKE_API_KEY and comma-separated EMBEDDINGS_SMOKE_MODELS are required",
  );
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};

async function smokeModel(model: string) {
  const response = await fetch(`${baseUrl}/v1/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, input: ["embeddings smoke test"] }),
  });
  if (!response.ok) {
    throw new Error(`${model} embedding failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    object?: string;
    model?: string;
    data?: Array<{ object?: string; embedding?: unknown; index?: number }>;
  };
  if (
    body.object !== "list" ||
    body.model !== model ||
    !Array.isArray(body.data) ||
    body.data.length !== 1 ||
    !Array.isArray(body.data[0]?.embedding)
  ) {
    throw new Error(`${model} embedding returned an unexpected payload`);
  }
}

for (const model of models) {
  await smokeModel(model);
  console.log(`Embeddings smoke passed for ${model}`);
}
