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

  it("trims trailing slashes from the endpoint", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp_1" }));
    const client = makeClient("https://example.openai.azure.com/");
    await client.createResponse({ model: "gpt-4o" });
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url.startsWith("https://example.openai.azure.com/openai/v1/responses?")).toBe(true);
  });
});
