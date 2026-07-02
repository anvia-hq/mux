import { afterEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("../../src/models-dev-provider-adapter", () => ({
  ModelsDevProviderAdapter: class {
    name: string;
    constructor(input: { name: string }) {
      this.name = input.name;
    }
    listModels() {
      return [];
    }
  },
}));

import { GoogleAdapter } from "../../src/providers/google";

vi.stubGlobal("fetch", mockFetch);

function makeJsonStream(chunks: string[]) {
  const encoder = new TextEncoder();
  const data = chunks.map((chunk) => encoder.encode(chunk));
  let index = 0;

  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index < data.length) {
          controller.enqueue(data[index++]);
          return;
        }

        controller.close();
      },
    }),
  );
}

describe("GoogleAdapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates adapter with name google", () => {
    const adapter = new GoogleAdapter("sk-test");
    expect(adapter.name).toBe("google");
  });

  it("merges request override headers after Google defaults", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    );

    const adapter = new GoogleAdapter("sk-test");
    await adapter.chatCompletion(
      {
        model: "gemini-test",
        messages: [{ role: "user", content: "hi" }],
      },
      {
        headers: {
          "content-type": "application/custom+json",
          "x-goog-user-project": "project-1",
        },
      },
    );

    expect(mockFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      "content-type": "application/custom+json",
      "x-goog-user-project": "project-1",
    });
    expect(mockFetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Content-Type");
  });

  it("maps streaming usage metadata into OpenAI-style usage", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonStream([
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }],
        }),
        JSON.stringify({
          usageMetadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 6,
            totalTokenCount: 10,
          },
        }),
      ]),
    );

    const adapter = new GoogleAdapter("sk-test");
    const chunks = [];
    for await (const chunk of adapter.chatCompletionStream({
      model: "gemini-test",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.at(-1)?.usage).toEqual({
      prompt_tokens: 4,
      completion_tokens: 6,
      total_tokens: 10,
    });
  });

  it("translates tools and JSON schema to Gemini format", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        candidates: [
          {
            content: { parts: [{ functionCall: { name: "lookup", args: { q: "hi" } } }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
      }),
    );

    const adapter = new GoogleAdapter("sk-test");
    const response = await adapter.chatCompletion({
      model: "gemini-test",
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: '{"q":"hi"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", name: "lookup", content: '{"ok":true}' },
      ],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "answer", schema: { type: "object" } },
      },
      max_completion_tokens: 123,
    });

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.tools[0].functionDeclarations).toEqual([
      { name: "lookup", parameters: { type: "object" } },
    ]);
    expect(requestBody.generationConfig).toMatchObject({
      maxOutputTokens: 123,
      responseMimeType: "application/json",
      responseSchema: { type: "object" },
    });
    expect(requestBody.contents[1].parts[0]).toMatchObject({ functionCall: { name: "lookup" } });
    expect(requestBody.contents[2].parts[0]).toMatchObject({
      functionResponse: { name: "lookup" },
    });
    expect(response.choices[0]?.message.tool_calls?.[0]).toMatchObject({
      function: { name: "lookup", arguments: '{"q":"hi"}' },
    });
  });
});
