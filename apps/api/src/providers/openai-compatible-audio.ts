import type { AudioProxyResponse } from "./types";

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
