import { streamTextResponseBody } from "./openai-compatible-stream";
import type { AudioProxyResponse, AudioProxyStreamResponse } from "./types";

export function cloneFormDataWithModel(formData: FormData, model: string): FormData {
  const clone = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key !== "model") {
      clone.append(key, value);
    }
  }
  clone.append("model", model);
  return clone;
}

export async function toAudioProxyResponse(response: Response): Promise<AudioProxyResponse> {
  const body = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? undefined;
  const usage = extractUsage(contentType, body);

  return { body, contentType, usage };
}

export function toAudioProxyStreamResponse(response: Response): AudioProxyStreamResponse {
  const contentType = response.headers.get("content-type") ?? undefined;
  return {
    stream: isTextStreamContentType(contentType)
      ? streamTextResponseBody(response)
      : streamBinaryResponseBody(response),
    contentType,
  };
}

async function* streamBinaryResponseBody(response: Response): AsyncIterable<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield value;
  }
}

function isTextStreamContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;

  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("javascript")
  );
}

function extractUsage(
  contentType: string | undefined,
  body: ArrayBuffer,
): Record<string, unknown> | undefined {
  if (!contentType?.toLowerCase().includes("json")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { usage?: unknown };
    return parsed.usage && typeof parsed.usage === "object"
      ? (parsed.usage as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
