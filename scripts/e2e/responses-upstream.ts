import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

type JsonObject = Record<string, unknown>;

type CapturedRequest = {
  id: number;
  method: string;
  path: string;
  query: Record<string, string[]>;
  channel: string;
  authorizationPresent: boolean;
  apiKeyPresent: boolean;
  headerNames: string[];
  body: JsonObject | null;
};

type StoredResponse = {
  body: JsonObject;
  scenario: string;
  polls: number;
};

const port = Number(process.env.E2E_RESPONSES_UPSTREAM_PORT ?? "8030");
const requests: CapturedRequest[] = [];
const responses = new Map<string, StoredResponse>();
let requestSequence = 0;
let responseSequence = 0;

function json(response: ServerResponse, status: number, body: unknown, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<JsonObject | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return null;
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonObject)
      : null;
  } catch {
    return null;
  }
}

function channelFor(request: IncomingMessage): string {
  const authorization = request.headers.authorization ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (token.includes("native-primary")) return "native-primary";
  if (token.includes("native-backup")) return "native-backup";
  if (token.includes("chat-primary")) return "chat-primary";
  if (token.includes("chat-backup")) return "chat-backup";
  const apiKey = String(request.headers["x-api-key"] ?? "");
  if (apiKey.includes("anthropic-primary")) return "anthropic-primary";
  if (apiKey.includes("anthropic-backup")) return "anthropic-backup";
  return "unknown";
}

function scenarioFor(body: JsonObject | null): string {
  const metadata = body?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "success";
  const scenario = (metadata as JsonObject).e2e_scenario;
  return typeof scenario === "string" ? scenario : "success";
}

function capture(request: IncomingMessage, url: URL, channel: string, body: JsonObject | null) {
  const query: Record<string, string[]> = {};
  for (const key of new Set(url.searchParams.keys())) query[key] = url.searchParams.getAll(key);
  requests.push({
    id: ++requestSequence,
    method: request.method ?? "GET",
    path: url.pathname,
    query,
    channel,
    authorizationPresent: Boolean(request.headers.authorization),
    apiKeyPresent: Boolean(request.headers["x-api-key"]),
    headerNames: Object.keys(request.headers)
      .map((name) => name.toLowerCase())
      .sort(),
    body,
  });
}

function responseObject(
  id: string,
  model: string,
  status: string,
  text = "Fixture native response",
): JsonObject {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1_000),
    status,
    model,
    output:
      status === "completed"
        ? [
            {
              id: `${id}_message_0`,
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text, annotations: [] }],
            },
          ]
        : [],
    usage:
      status === "completed"
        ? {
            input_tokens: 12,
            output_tokens: 8,
            total_tokens: 20,
            output_tokens_details: { reasoning_tokens: 2 },
          }
        : undefined,
  };
}

function sse(type: string, payload: JsonObject): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

async function writeFragments(response: ServerResponse, value: string, fragmented: boolean) {
  if (!fragmented) {
    response.write(value);
    return;
  }
  const sizes = [1, 7, 3, 11, 2, 17];
  let offset = 0;
  let index = 0;
  while (offset < value.length) {
    const size = sizes[index++ % sizes.length] ?? 5;
    response.write(value.slice(offset, offset + size));
    offset += size;
    await delay(2);
  }
}

async function nativeCreate(response: ServerResponse, channel: string, body: JsonObject) {
  const scenario = scenarioFor(body);
  if (scenario === "retryable_primary" && channel === "native-primary") {
    json(response, 503, {
      error: { message: "fixture primary unavailable secret=do-not-forward", type: "server_error" },
    });
    return;
  }
  if (scenario === "non_retryable") {
    json(
      response,
      400,
      {
        error: {
          message: "fixture rejected api_key=sk-fixturesecret123456",
          type: "invalid_request_error",
        },
      },
      { "retry-after": "9" },
    );
    return;
  }
  if (scenario === "slow_first_byte") await delay(1_000);

  const id = `resp_fixture_${++responseSequence}`;
  const model = typeof body.model === "string" ? body.model : "fixture-model";
  if (body.background === true) {
    const queued = responseObject(id, model, "queued");
    responses.set(id, { body: queued, scenario, polls: 0 });
    json(response, 200, queued, { "x-fixture-upstream": channel });
    return;
  }

  if (body.stream !== true) {
    json(response, 200, responseObject(id, model, "completed"), {
      "x-fixture-upstream": channel,
      "x-request-id": "must-not-overwrite-gateway-request-id",
      "set-cookie": "must-not-forward=true",
    });
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "x-fixture-upstream": channel,
  });
  const created = responseObject(id, model, "in_progress");
  const completed = responseObject(id, model, "completed", "Fixture streamed response");
  const fragmented = scenario === "fragmented_stream";
  await writeFragments(response, sse("response.created", { response: created }), fragmented);
  if (scenario === "idle_timeout") await delay(1_000);
  await writeFragments(
    response,
    sse("response.output_text.delta", {
      output_index: 0,
      content_index: 0,
      delta: "Fixture streamed response",
    }),
    fragmented,
  );
  if (scenario === "malformed_stream") {
    response.write("event: response.completed\ndata: {not-json}\n\n");
  } else if (scenario === "stream_error") {
    response.write(
      sse("response.error", {
        code: "fixture_error",
        message: "fixture stream failed",
        param: null,
      }),
    );
  } else if (scenario !== "missing_terminal" && scenario !== "idle_timeout") {
    await writeFragments(response, sse("response.completed", { response: completed }), fragmented);
  }
  response.end();
}

function chatResponse(body: JsonObject, scenario: string): JsonObject {
  const model = typeof body.model === "string" ? body.model : "fixture-chat-model";
  const message: JsonObject = {
    role: "assistant",
    content:
      scenario === "structured_output"
        ? JSON.stringify({ answer: "fixture" })
        : "Fixture chat-converted response",
    reasoning_content: scenario === "reasoning" ? "Fixture reasoning" : undefined,
  };
  if (scenario === "tool_call") {
    message.content = null;
    message.tool_calls = [
      {
        id: "call_fixture_weather",
        type: "function",
        function: { name: "get_weather", arguments: JSON.stringify({ city: "Jakarta" }) },
      },
    ];
  }
  return {
    id: `chatcmpl_fixture_${++responseSequence}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model,
    choices: [
      { index: 0, message, finish_reason: scenario === "tool_call" ? "tool_calls" : "stop" },
    ],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  };
}

async function chatCreate(response: ServerResponse, channel: string, body: JsonObject) {
  const scenario = scenarioFor(body);
  if (scenario === "retryable_primary" && channel === "chat-primary") {
    json(response, 503, { error: { message: "fixture chat primary unavailable" } });
    return;
  }
  if (body.stream !== true) {
    json(response, 200, chatResponse(body, scenario), { "x-fixture-upstream": channel });
    return;
  }

  const id = `chatcmpl_fixture_${++responseSequence}`;
  const model = typeof body.model === "string" ? body.model : "fixture-chat-model";
  response.writeHead(200, { "content-type": "text/event-stream", "x-fixture-upstream": channel });
  response.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", reasoning_content: "Think " },
          finish_reason: null,
        },
      ],
    })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [{ index: 0, delta: { content: "Fixture chat stream" }, finish_reason: null }],
    })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

function anthropicMessage(body: JsonObject): JsonObject {
  return {
    id: `msg_fixture_${++responseSequence}`,
    type: "message",
    role: "assistant",
    model: typeof body.model === "string" ? body.model : "claude-haiku-4-5",
    content: [{ type: "text", text: "Fixture Anthropic response" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 12,
      output_tokens: 8,
      cache_creation_input_tokens: 3,
      cache_read_input_tokens: 2,
    },
  };
}

async function anthropicCreate(response: ServerResponse, channel: string, body: JsonObject) {
  const scenario = scenarioFor(body);
  if (scenario === "retryable_primary" && channel === "anthropic-primary") {
    json(response, 503, {
      type: "error",
      error: { type: "api_error", message: "fixture primary unavailable" },
    });
    return;
  }
  if (scenario === "non_retryable") {
    json(
      response,
      400,
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "fixture rejected x-api-key: sk-fixturesecret123456",
        },
      },
      { "retry-after": "9" },
    );
    return;
  }
  if (scenario === "slow_first_byte") await delay(1_000);

  if (body.stream !== true) {
    json(response, 200, anthropicMessage(body), {
      "x-fixture-upstream": channel,
      "x-request-id": "must-not-overwrite-gateway-request-id",
      "set-cookie": "must-not-forward=true",
    });
    return;
  }

  const id = `msg_fixture_${++responseSequence}`;
  const model = typeof body.model === "string" ? body.model : "claude-haiku-4-5";
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "x-fixture-upstream": channel,
  });
  const fragmented = scenario === "fragmented_stream";
  await writeFragments(
    response,
    sse("message_start", {
      message: {
        id,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        usage: {
          input_tokens: 12,
          output_tokens: 0,
          cache_creation_input_tokens: 3,
          cache_read_input_tokens: 2,
        },
      },
    }),
    fragmented,
  );
  if (scenario === "idle_timeout") await delay(1_000);
  await writeFragments(
    response,
    sse("content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text: "Fixture Anthropic stream" },
    }),
    fragmented,
  );
  await writeFragments(
    response,
    sse("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 8 },
    }),
    fragmented,
  );
  if (scenario === "stream_error") {
    await writeFragments(
      response,
      sse("error", {
        error: {
          type: "api_error",
          message: "stream failed authorization: Bearer sk-streamsecret123456",
        },
      }),
      fragmented,
    );
  } else if (scenario !== "missing_terminal" && scenario !== "idle_timeout") {
    await writeFragments(response, sse("message_stop", {}), fragmented);
  }
  response.end();
}

async function handleResponseOperation(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) {
  const segments = url.pathname.split("/").filter(Boolean);
  const id = segments[2] ?? "";
  const operation = segments[3];
  const stored = responses.get(id);

  if (operation === "input_items" && request.method === "GET") {
    json(response, 200, {
      object: "list",
      data: [
        {
          id: "item_fixture_1",
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Fixture input item" }],
        },
      ],
      first_id: "item_fixture_1",
      last_id: "item_fixture_1",
      has_more: false,
    });
    return;
  }
  if (operation === "cancel" && request.method === "POST") {
    const cancelled = responseObject(
      id,
      String(stored?.body.model ?? "fixture-model"),
      "cancelled",
    );
    if (stored) stored.body = cancelled;
    json(response, 200, cancelled);
    return;
  }
  if (request.method === "DELETE") {
    responses.delete(id);
    json(response, 200, { id, object: "response.deleted", deleted: true });
    return;
  }
  if (request.method === "GET") {
    if (!stored) {
      json(response, 200, responseObject(id, "fixture-model", "completed", "Fixture retrieved"));
      return;
    }
    stored.polls += 1;
    if (stored.body.status !== "cancelled") {
      stored.body = responseObject(
        id,
        String(stored.body.model ?? "fixture-model"),
        "completed",
        "Fixture background completed",
      );
    }
    json(response, 200, stored.body);
    return;
  }
  json(response, 404, { error: { message: "not found" } });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") {
    json(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/__fixture/reset" && request.method === "POST") {
    requests.length = 0;
    responses.clear();
    requestSequence = 0;
    responseSequence = 0;
    json(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/__fixture/requests" && request.method === "GET") {
    json(response, 200, { requests });
    return;
  }

  const body = request.method === "POST" ? await readJson(request) : null;
  const channel = channelFor(request);
  capture(request, url, channel, body);

  try {
    if (url.pathname === "/v1/responses" && request.method === "POST" && body) {
      await nativeCreate(response, channel, body);
      return;
    }
    if (url.pathname === "/v1/chat/completions" && request.method === "POST" && body) {
      await chatCreate(response, channel, body);
      return;
    }
    if (url.pathname === "/v1/messages/count_tokens" && request.method === "POST") {
      json(response, 200, { input_tokens: 42 }, { "x-fixture-upstream": channel });
      return;
    }
    if (url.pathname === "/v1/messages" && request.method === "POST" && body) {
      await anthropicCreate(response, channel, body);
      return;
    }
    if (url.pathname === "/v1/responses/input_tokens" && request.method === "POST") {
      json(response, 200, { input_tokens: 42, usage: { input_tokens: 42, total_tokens: 42 } });
      return;
    }
    if (url.pathname === "/v1/responses/compact" && request.method === "POST") {
      json(
        response,
        200,
        responseObject(
          `resp_fixture_${++responseSequence}`,
          "fixture-model",
          "completed",
          "Fixture compacted context",
        ),
      );
      return;
    }
    if (url.pathname.startsWith("/v1/responses/")) {
      await handleResponseOperation(request, response, url);
      return;
    }
    json(response, 404, { error: { message: "fixture route not found" } });
  } catch (error) {
    if (!response.headersSent) {
      json(response, 500, {
        error: { message: error instanceof Error ? error.message : String(error) },
      });
    } else {
      response.destroy(error instanceof Error ? error : undefined);
    }
  }
});

await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
console.log(`E2E Responses upstream listening on http://127.0.0.1:${port}`);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
