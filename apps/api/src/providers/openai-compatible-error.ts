export class UpstreamOpenAICompatibleError extends Error {
  readonly provider: string;
  readonly status: number;
  readonly body: string;
  readonly contentType?: string;

  constructor(input: { provider: string; status: number; body: string; contentType?: string }) {
    super(`${input.provider} OpenAI-compatible API error: ${input.status} - ${input.body}`);
    this.name = "UpstreamOpenAICompatibleError";
    this.provider = input.provider;
    this.status = input.status;
    this.body = input.body;
    this.contentType = input.contentType;
  }

  get jsonError(): unknown | null {
    try {
      const parsed = JSON.parse(this.body) as { error?: unknown };
      return parsed?.error ?? parsed;
    } catch {
      return null;
    }
  }
}

export async function throwOpenAICompatibleError(
  provider: string,
  response: Response,
): Promise<never> {
  throw new UpstreamOpenAICompatibleError({
    provider,
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get("content-type") ?? undefined,
  });
}

export function upstreamOpenAICompatibleErrorResponse(error: unknown): Response | null {
  if (!(error instanceof UpstreamOpenAICompatibleError)) {
    return null;
  }

  const headers = new Headers();
  if (error.contentType) {
    headers.set("Content-Type", error.contentType);
  }

  return new Response(error.body, {
    status: error.status,
    headers,
  });
}

export function upstreamOpenAICompatibleStatusCode(error: unknown): number {
  return error instanceof UpstreamOpenAICompatibleError ? error.status : 500;
}
