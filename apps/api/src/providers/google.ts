import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
} from "./types";

const GOOGLE_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 60_000;

export class GoogleAdapter implements ProviderAdapter {
  name = "google";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private getApiUrl(model: string, stream: boolean): string {
    const endpoint = stream ? "streamGenerateContent" : "generateContent";
    return `${GOOGLE_API_BASE_URL}/${model}:${endpoint}?key=${this.apiKey}`;
  }

  private convertMessages(messages: ChatCompletionRequest["messages"]) {
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const systemInstruction = messages.find((m) => m.role === "system");

    return {
      contents,
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction.content }] }
        : undefined,
    };
  }

  private buildRequestBody(request: ChatCompletionRequest, _stream: boolean): string {
    const converted = this.convertMessages(request.messages);
    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.max_tokens !== undefined) generationConfig.maxOutputTokens = request.max_tokens;

    const body: Record<string, unknown> = {
      contents: converted.contents,
      generationConfig,
    };
    if (converted.systemInstruction) {
      body.systemInstruction = converted.systemInstruction;
    }
    return JSON.stringify(body);
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
    };
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(this.getApiUrl(request.model, false), {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, false),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      id?: string;
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.[0]?.text ?? "";

    return {
      id: data.id ?? `google-${Date.now()}`,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
          },
          finish_reason: candidate?.finishReason ?? "stop",
        },
      ],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(this.getApiUrl(request.model, true), {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, true),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    // Google streams JSON objects (each chunk is a separate JSON object, sometimes wrapped in arrays).
    // Extract each complete top-level JSON object from the buffer and yield it.
    function* processBuffer(): Generator<ChatCompletionChunk> {
      while (buffer.length > 0) {
        const trimmed = buffer.trimStart();
        if (trimmed.length === 0) {
          buffer = "";
          break;
        }

        const ch = trimmed[0];
        if (ch !== "[" && ch !== "{") {
          // Unexpected leading character; drop it to avoid infinite loop
          buffer = trimmed.slice(1);
          continue;
        }

        // Find the matching closing bracket while respecting string nesting.
        let depth = 0;
        let inString = false;
        let escaped = false;
        let closeIdx = -1;
        for (let i = 0; i < trimmed.length; i++) {
          const c = trimmed[i];
          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (c === "\\") {
              escaped = true;
            } else if (c === '"') {
              inString = false;
            }
            continue;
          }
          if (c === '"') {
            inString = true;
          } else if (c === "{" || c === "[") {
            depth++;
          } else if (c === "}" || c === "]") {
            depth--;
            if (depth === 0) {
              closeIdx = i;
              break;
            }
          }
        }

        if (closeIdx === -1) {
          // Incomplete JSON; wait for more data
          buffer = trimmed;
          break;
        }

        const jsonText = trimmed.slice(0, closeIdx + 1);
        buffer = trimmed.slice(closeIdx + 1);

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch (err) {
          // Skip non-fatal parse failures to keep the stream alive on a bad chunk
          console.warn(
            `Failed to parse Google stream chunk, skipping: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }

        const chunks = Array.isArray(parsed) ? parsed : [parsed];
        for (const chunk of chunks) {
          const c = chunk as {
            id?: string;
            candidates?: {
              content?: { parts?: { text?: string }[] };
              finishReason?: string;
            }[];
          };
          const candidate = c.candidates?.[0];
          const text = candidate?.content?.parts?.[0]?.text;
          if (text !== undefined) {
            yield {
              id: c.id ?? `google-${Date.now()}`,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: { content: text },
                  finish_reason: candidate?.finishReason ?? null,
                },
              ],
            };
          }
        }
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      yield* processBuffer();
    }

    // Flush any remaining bytes from the decoder and process any trailing JSON
    buffer += decoder.decode();
    yield* processBuffer();
  }

  listModels(): Model[] {
    return [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: this.name },
      { id: "gemini-2.0-pro", name: "Gemini 2.0 Pro", provider: this.name },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: this.name },
    ];
  }
}
