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
  const data = chunks.map((chunk) => encoder.encode(`data: ${chunk}\n\n`));
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
    { headers: { "Content-Type": "text/event-stream" } },
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
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain("streamGenerateContent?alt=sse&key=");
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
    expect(response.choices[0]?.message.tool_calls?.[0]?.id).toMatch(/^call_[0-9a-f-]{36}$/);
    expect(response.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("resolves and groups unnamed parallel tool results from assistant history", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        candidates: [{ content: { parts: [{ text: "done" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    );

    const adapter = new GoogleAdapter("sk-test");
    await adapter.chatCompletion({
      model: "gemini-test",
      messages: [
        { role: "user", content: "compare" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_lookup",
              type: "function",
              function: { name: "lookup", arguments: '{"q":"one"}' },
            },
            {
              id: "call_weather",
              type: "function",
              function: { name: "weather", arguments: '{"city":"Jakarta"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_lookup", content: '{"result":1}' },
        { role: "tool", tool_call_id: "call_weather", content: "[30]" },
      ],
    });

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.contents).toHaveLength(3);
    expect(requestBody.contents[2]).toMatchObject({
      role: "user",
      parts: [
        { functionResponse: { name: "lookup", response: { result: 1 } } },
        { functionResponse: { name: "weather", response: { result: [30] } } },
      ],
    });
  });

  it("converts every non-streaming candidate and function call", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: "checking" },
                { functionCall: { name: "lookup", args: { q: "one" } } },
                { functionCall: { name: "weather", args: { city: "Jakarta" } } },
              ],
            },
            finishReason: "STOP",
          },
          { content: { parts: [{ text: "alternate" }] }, finishReason: "MAX_TOKENS" },
        ],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
      }),
    );

    const response = await new GoogleAdapter("sk-test").chatCompletion({
      model: "gemini-test",
      messages: [{ role: "user", content: "compare" }],
    });

    expect(response.choices).toHaveLength(2);
    expect(response.choices[0]?.message.tool_calls).toHaveLength(2);
    expect(response.choices[0]?.message.tool_calls?.[0]?.id).not.toBe(
      response.choices[0]?.message.tool_calls?.[1]?.id,
    );
    expect(response.choices[0]?.finish_reason).toBe("tool_calls");
    expect(response.choices[1]?.finish_reason).toBe("length");
  });

  it("streams all text and parallel tool parts with OpenAI delta semantics", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonStream([
        JSON.stringify({
          id: "gemini-stream-1",
          candidates: [
            {
              index: 0,
              content: {
                parts: [
                  { text: "checking" },
                  { functionCall: { name: "lookup", args: { q: "one" } } },
                  { functionCall: { name: "weather", args: { city: "Jakarta" } } },
                ],
              },
              finishReason: "STOP",
            },
            {
              index: 1,
              content: { parts: [{ text: "alternate" }] },
              finishReason: "MAX_TOKENS",
            },
          ],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6, totalTokenCount: 10 },
        }),
      ]),
    );

    const chunks = [];
    for await (const chunk of new GoogleAdapter("sk-test").chatCompletionStream({
      model: "gemini-test",
      messages: [{ role: "user", content: "compare" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.choices[0]?.delta).toEqual({ role: "assistant", content: "" });
    expect(chunks.some((chunk) => chunk.choices[0]?.delta.content === "checking")).toBe(true);
    const metadata = chunks.flatMap(
      (chunk) => chunk.choices[0]?.delta.tool_calls?.filter((call) => call.id !== undefined) ?? [],
    );
    const argumentsDeltas = chunks.flatMap(
      (chunk) => chunk.choices[0]?.delta.tool_calls?.filter((call) => call.id === undefined) ?? [],
    );
    expect(metadata.map((call) => call.index)).toEqual([0, 1]);
    expect(metadata[0]?.id).not.toBe(metadata[1]?.id);
    expect(metadata.every((call) => call.function?.arguments === "")).toBe(true);
    expect(argumentsDeltas.map((call) => call.index)).toEqual([0, 1]);
    expect(argumentsDeltas.every((call) => call.function?.name === undefined)).toBe(true);
    expect(
      chunks.find((chunk) => chunk.choices[0]?.index === 0 && chunk.choices[0].finish_reason)
        ?.choices[0]?.finish_reason,
    ).toBe("tool_calls");
    expect(
      chunks.find((chunk) => chunk.choices[0]?.index === 1 && chunk.choices[0].finish_reason)
        ?.choices[0]?.finish_reason,
    ).toBe("length");
    expect(chunks.at(-1)).toMatchObject({
      choices: [],
      usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
    });
  });

  it("fails malformed streaming JSON instead of silently dropping it", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonStream(["unexpected"]));

    const consume = async () => {
      for await (const _chunk of new GoogleAdapter("sk-test").chatCompletionStream({
        model: "gemini-test",
        messages: [{ role: "user", content: "hi" }],
      })) {
        // Drain stream.
      }
    };

    await expect(consume()).rejects.toThrow("Failed to parse Google stream chunk");
  });
});
