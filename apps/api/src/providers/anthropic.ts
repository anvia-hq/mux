import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
} from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export class AnthropicAdapter implements ProviderAdapter {
  name = "anthropic";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private convertMessages(messages: ChatCompletionRequest["messages"]) {
    const system = messages.find((m) => m.role === "system")?.content;
    const nonSystem = messages.filter((m) => m.role !== "system");
    return { system, messages: nonSystem };
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { system, messages } = this.convertMessages(request.messages);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.max_tokens ?? 4096,
        system,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      id: string;
      model: string;
      content: { text: string }[];
      stop_reason: string | null;
      usage: { input_tokens: number; output_tokens: number };
    };

    // Convert Anthropic response to OpenAI format
    return {
      id: data.id,
      model: data.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: data.content[0].text,
          },
          finish_reason: data.stop_reason,
        },
      ],
      usage: {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const { system, messages } = this.convertMessages(request.messages);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.max_tokens ?? 4096,
        system,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6)) as {
            type: string;
            id: string;
            delta?: { text?: string };
          };

          // Convert Anthropic events to OpenAI format
          if (data.type === "content_block_delta") {
            yield {
              id: data.id,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: { content: data.delta?.text ?? "" },
                  finish_reason: null,
                },
              ],
            };
          } else if (data.type === "message_stop") {
            yield {
              id: data.id,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            };
          }
        }
      }
    }
  }

  listModels(): Model[] {
    return [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: this.name },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: this.name },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: this.name },
    ];
  }
}
