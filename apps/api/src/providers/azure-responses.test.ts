import { afterEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.stubGlobal("fetch", mockFetch);

import {
  AZURE_OPENAI_RESPONSES_API_VERSION,
} from "./models-dev-provider-adapter";
import {
  AzureResponsesClient,
  AzureResponsesEndpointNotConfiguredError,
} from "./azure-responses";
import type { ResponseCreateRequest, ResponseObject } from "./types";

function makeClient(endpoint?: string) {
  return new AzureResponsesClient({
    providerName: "azure-cognitive-services",
    apiKey: "sk-test",
    endpoint,
  });
}

describe("AzureResponsesClient", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("builds the responses URL with the api-version query", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp_1", object: "response" }));
    const client = makeClient("https://example.openai.azure.com");
    await client.createResponse({ model: "gpt-4o", input: "hi" });

    expect(mockFetch).toHaveBeenCalledWith(
      `https://example.openai.azure.com/openai/v1/responses?api-version=${encodeURIComponent(AZURE_OPENAI_RESPONSES_API_VERSION)}`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("throws AzureResponsesEndpointNotConfiguredError when endpoint is missing", async () => {
    const client = makeClient(undefined);
    await expect(client.createResponse({ model: "gpt-4o" })).rejects.toBeInstanceOf(
      AzureResponsesEndpointNotConfiguredError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns the upstream JSON body on createResponse", async () => {
    const body = { id: "resp_1", object: "response", status: "completed" };
    mockFetch.mockResolvedValueOnce(Response.json(body));
    const client = makeClient("https://example.openai.azure.com");
    const result: ResponseObject = await client.createResponse({
      model: "gpt-4o",
      input: "hi",
    });
    expect(result).toMatchObject(body);
  });

  it("propagates upstream errors from createResponse with status and body", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("internal error", { status: 500, headers: { "Content-Type": "text/plain" } }),
    );
    const client = makeClient("https://example.openai.azure.com");
    await expect(client.createResponse({ model: "gpt-4o" })).rejects.toThrow(
      "azure-cognitive-services Responses API error: 500 - internal error",
    );
  });

  it("forces stream=true and yields the upstream SSE bytes for createResponseStream", async () => {
    const sse =
      'event: response.created\ndata: {"type":"response.created"}\n\n' +
      'event: response.completed\ndata: {"type":"response.completed"}\n\n';
    const encoder = new TextEncoder();
    mockFetch.mockResolvedValueOnce(
      new Response(encoder.encode(sse), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const client = makeClient("https://example.openai.azure.com");
    const request: ResponseCreateRequest = { model: "gpt-4o", input: "hi" };
    const chunks: string[] = [];
    for await (const chunk of client.createResponseStream(request)) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe(sse);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call?.[1]?.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe("gpt-4o");
  });

  it("propagates upstream errors from createResponseStream", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );
    const client = makeClient("https://example.openai.azure.com");
    const iterator = client.createResponseStream({ model: "gpt-4o" });
    await expect(iterator[Symbol.asyncIterator]().next()).rejects.toThrow(
      "azure-cognitive-services Responses API error: 404 - not found",
    );
  });

  it("encodes the response id and includes the api-version on getResponse", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp/abc" }));
    const client = makeClient("https://example.openai.azure.com");
    await client.getResponse("resp/abc");

    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toBe(
      `https://example.openai.azure.com/openai/v1/responses/resp%2Fabc?api-version=${encodeURIComponent(AZURE_OPENAI_RESPONSES_API_VERSION)}`,
    );
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("returns the upstream body on getResponse", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp_1", status: "completed" }));
    const client = makeClient("https://example.openai.azure.com");
    const result = await client.getResponse("resp_1");
    expect(result).toMatchObject({ id: "resp_1", status: "completed" });
  });

  it("propagates upstream errors from getResponse", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("nope", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );
    const client = makeClient("https://example.openai.azure.com");
    await expect(client.getResponse("resp_x")).rejects.toThrow(
      "azure-cognitive-services Responses API error: 404 - nope",
    );
  });

  it("encodes the response id on deleteResponse", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp_1", deleted: true }));
    const client = makeClient("https://example.openai.azure.com");
    await client.deleteResponse("resp/1");
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain("/openai/v1/responses/resp%2F1");
    expect(url).toContain(`api-version=${encodeURIComponent(AZURE_OPENAI_RESPONSES_API_VERSION)}`);
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("returns the upstream body on deleteResponse", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp_1", deleted: true }));
    const client = makeClient("https://example.openai.azure.com");
    const result = await client.deleteResponse("resp_1");
    expect(result).toMatchObject({ id: "resp_1", deleted: true });
  });

  it("propagates upstream errors from deleteResponse", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("nope", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );
    const client = makeClient("https://example.openai.azure.com");
    await expect(client.deleteResponse("resp_x")).rejects.toThrow(
      "azure-cognitive-services Responses API error: 404 - nope",
    );
  });

  it("cancels a response and returns the upstream body", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ id: "resp_1", object: "response", status: "cancelled" }),
    );
    const client = makeClient("https://example.openai.azure.com");
    const result = await client.cancelResponse("resp_1");

    expect(result).toMatchObject({ id: "resp_1", status: "cancelled" });
    expect(mockFetch).toHaveBeenCalledWith(
      `https://example.openai.azure.com/openai/v1/responses/resp_1/cancel?api-version=${encodeURIComponent(AZURE_OPENAI_RESPONSES_API_VERSION)}`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("encodes the response id in the cancel URL", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp/1", status: "cancelled" }));
    const client = makeClient("https://example.openai.azure.com");
    await client.cancelResponse("resp/1");
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain("/openai/v1/responses/resp%2F1/cancel");
    expect(url).toContain(`api-version=${encodeURIComponent(AZURE_OPENAI_RESPONSES_API_VERSION)}`);
  });

  it("propagates upstream errors from cancelResponse", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("nope", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );
    const client = makeClient("https://example.openai.azure.com");
    await expect(client.cancelResponse("resp_x")).rejects.toThrow(
      "azure-cognitive-services Responses API error: 404 - nope",
    );
  });

  it("throws AzureResponsesEndpointNotConfiguredError on cancel when endpoint is missing", async () => {
    const client = makeClient(undefined);
    await expect(client.cancelResponse("resp_x")).rejects.toBeInstanceOf(
      AzureResponsesEndpointNotConfiguredError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("compacts a response and returns the upstream body", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "resp_001",
        object: "response.compaction",
        output: [
          { id: "cmp_001", type: "compaction", encrypted_content: "gAAAAA..." },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }),
    );
    const client = makeClient("https://example.openai.azure.com");
    const result = await client.compactResponse({ model: "gpt-5", input: "hi" });

    expect(result).toMatchObject({ id: "resp_001", object: "response.compaction" });
    expect(mockFetch).toHaveBeenCalledWith(
      `https://example.openai.azure.com/openai/v1/responses/compact?api-version=${encodeURIComponent(AZURE_OPENAI_RESPONSES_API_VERSION)}`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("serializes the compact body as JSON", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp_001" }));
    const client = makeClient("https://example.openai.azure.com");
    await client.compactResponse({ model: "gpt-5", input: [{ role: "user", content: "hi" }] });

    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-5",
      input: [{ role: "user", content: "hi" }],
    });
  });

  it("propagates upstream errors from compactResponse", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("nope", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );
    const client = makeClient("https://example.openai.azure.com");
    await expect(client.compactResponse({ model: "gpt-5" })).rejects.toThrow(
      "azure-cognitive-services Responses API error: 404 - nope",
    );
  });

  it("throws AzureResponsesEndpointNotConfiguredError on compact when endpoint is missing", async () => {
    const client = makeClient(undefined);
    await expect(client.compactResponse({ model: "gpt-5" })).rejects.toBeInstanceOf(
      AzureResponsesEndpointNotConfiguredError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("lists input items for a response", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        object: "list",
        data: [
          {
            id: "msg_abc",
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Tell me a story." }],
          },
        ],
        first_id: "msg_abc",
        last_id: "msg_abc",
        has_more: false,
      }),
    );
    const client = makeClient("https://example.openai.azure.com");
    const result = await client.listResponseInputItems("resp_abc");

    expect(result).toMatchObject({
      object: "list",
      data: [{ id: "msg_abc", role: "user" }],
      has_more: false,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `https://example.openai.azure.com/openai/v1/responses/resp_abc/input_items?api-version=${encodeURIComponent(AZURE_OPENAI_RESPONSES_API_VERSION)}`,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("encodes the response id in the input_items URL", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ object: "list", data: [] }));
    const client = makeClient("https://example.openai.azure.com");
    await client.listResponseInputItems("resp/abc");

    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain("/openai/v1/responses/resp%2Fabc/input_items");
    expect(url).toContain(`api-version=${encodeURIComponent(AZURE_OPENAI_RESPONSES_API_VERSION)}`);
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("forwards query params verbatim to input_items", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ object: "list", data: [] }));
    const client = makeClient("https://example.openai.azure.com");
    await client.listResponseInputItems("resp_abc", {
      after: "msg_xyz",
      include: ["file_search_call.results", "message.input_image.image_url"],
      limit: "20",
      order: "desc",
    });

    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain("/openai/v1/responses/resp_abc/input_items");
    expect(url).toContain("after=msg_xyz");
    expect(url).toContain("include=file_search_call.results");
    expect(url).toContain("include=message.input_image.image_url");
    expect(url).toContain("limit=20");
    expect(url).toContain("order=desc");
    expect(url).toContain(`api-version=${encodeURIComponent(AZURE_OPENAI_RESPONSES_API_VERSION)}`);
  });

  it("propagates upstream errors from listResponseInputItems", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("nope", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );
    const client = makeClient("https://example.openai.azure.com");
    await expect(client.listResponseInputItems("resp_x")).rejects.toThrow(
      "azure-cognitive-services Responses API error: 404 - nope",
    );
  });

  it("throws AzureResponsesEndpointNotConfiguredError on input_items when endpoint is missing", async () => {
    const client = makeClient(undefined);
    await expect(client.listResponseInputItems("resp_x")).rejects.toBeInstanceOf(
      AzureResponsesEndpointNotConfiguredError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("trims trailing slashes from the endpoint", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp_1" }));
    const client = makeClient("https://example.openai.azure.com/");
    await client.createResponse({ model: "gpt-4o" });
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url.startsWith("https://example.openai.azure.com/openai/v1/responses?")).toBe(true);
  });
});
