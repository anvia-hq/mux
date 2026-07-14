import { UpstreamOpenAICompatibleError } from "./openai-compatible-error";

export class UpstreamResponsesApiError extends UpstreamOpenAICompatibleError {
  constructor(
    status: number,
    body: string,
    provider = "OpenAI",
    contentType?: string,
    retryAfter?: string,
  ) {
    super({ provider, status, body, contentType, retryAfter });
    this.message = `${provider} Responses API error: ${status} - ${body}`;
    this.name = "UpstreamResponsesApiError";
  }

  get jsonError(): {
    message?: string;
    type?: string;
    param?: string | null;
    code?: string | null;
  } | null {
    try {
      const parsed = JSON.parse(this.body) as { error?: unknown };
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        return parsed.error as {
          message?: string;
          type?: string;
          param?: string | null;
          code?: string | null;
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}

export async function throwResponsesApiError(provider: string, response: Response): Promise<never> {
  throw new UpstreamResponsesApiError(
    response.status,
    await response.text(),
    provider,
    response.headers.get("content-type") ?? undefined,
    response.headers.get("retry-after") ?? undefined,
  );
}
