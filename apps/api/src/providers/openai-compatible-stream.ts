export async function* streamTextResponseBody(response: Response): AsyncIterable<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }

  const final = decoder.decode();
  if (final) yield final;
}

export async function* streamImageGenerationResponseBody(
  response: Response,
): AsyncIterable<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream")) {
    yield* streamTextResponseBody(response);
    return;
  }

  const body = await response.text();
  if (!body) throw new Error("No response body");

  let data = body;
  try {
    data = JSON.stringify(JSON.parse(body));
  } catch {}

  yield `event: image_generation.completed\ndata: ${data}\n\n`;
  yield "data: [DONE]\n\n";
}
