import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";
import { apiKeyAuth } from "../../middleware/api-key";
import {
  logStreamFinal,
  logStreamStart,
  RequestLoggingUnavailableError,
} from "../../middleware/logger";
import { estimateCost } from "../../providers/registry";
import type { ResponseCreateRequest, ResponseUsage } from "../../providers/types";
import {
  addApiKeySpendUsd,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyCanSpend,
} from "../keys/services";
import {
  ApiKeyUnbillableResponseUsageError,
  handleResponseCreate,
  handleResponseCreateStream,
  handleResponseRetrieve,
  OpenAIResponseProviderNotConfiguredError,
  UnsupportedResponseFeatureError,
  validateResponseCreateRequestShape,
} from "./services";

export const responsesRouter = new Hono();

responsesRouter.use("*", apiKeyAuth);

responsesRouter.post("/", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

  let body: ResponseCreateRequest;
  try {
    body = (await c.req.json()) as ResponseCreateRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const validationError = validateResponseCreateRequestShape(body);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  if (body.background === true) {
    return c.json({ error: "Responses background mode is not supported yet" }, 422);
  }

  try {
    if (isLimitedKey) {
      await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
    }

    if (body.stream === true) {
      const result = await handleResponseCreateStream(body);
      const { stream: streamIterable, provider, model, startTime } = result;
      const logId = await logStreamStart({
        apiKeyId,
        provider,
        model,
        endpoint: "/v1/responses",
        latencyMs: 0,
        statusCode: 102,
        errorMessage: "stream pending",
      });

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      return honoStream(c, async (streamWriter) => {
        const usageObserver = createResponseStreamUsageObserver();

        try {
          for await (const chunk of streamIterable) {
            observeResponseStreamUsage(chunk, usageObserver);
            await streamWriter.write(chunk);
          }

          const latencyMs = Date.now() - startTime;
          const usage = usageObserver.usage;
          const estimatedCost = estimateCost(model, usage?.input_tokens, usage?.output_tokens);

          if (isLimitedKey && estimatedCost !== undefined) {
            try {
              await addApiKeySpendUsd(apiKeyId, estimatedCost);
            } catch (spendError) {
              console.error("Failed to record streamed response spend:", spendError);
            }
          }

          try {
            await logStreamFinal({
              logId,
              apiKeyId,
              provider,
              model,
              endpoint: "/v1/responses",
              latencyMs,
              promptTokens: usage?.input_tokens,
              completionTokens: usage?.output_tokens,
              totalTokens: usage?.total_tokens,
              estimatedCost,
              statusCode: 200,
            });
          } catch (logError) {
            console.error("Failed to finalize response stream log:", logError);
          }
        } catch (streamError) {
          const latencyMs = Date.now() - startTime;
          const errorMessage = streamError instanceof Error ? streamError.message : "Unknown error";

          try {
            await logStreamFinal({
              logId,
              apiKeyId,
              provider,
              model,
              endpoint: "/v1/responses",
              latencyMs,
              statusCode: 500,
              errorMessage,
            });
          } catch (logError) {
            console.error("Failed to finalize failed response stream log:", logError);
          }

          throw streamError;
        }
      });
    }

    const response = await handleResponseCreate(body, apiKeyId, {
      requireBillableUsage: isLimitedKey,
    });

    return c.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (errorMessage.startsWith("No provider found")) {
      return c.json({ error: errorMessage }, 404);
    }

    if (error instanceof ApiKeySpendLimitExceededError) {
      return c.json({ error: errorMessage }, 429);
    }

    if (error instanceof ApiKeyUnbillableResponseUsageError) {
      return c.json({ error: errorMessage }, 429);
    }

    if (
      error instanceof RequestLoggingUnavailableError ||
      error instanceof ApiKeySpendLedgerUnavailableError
    ) {
      return c.json({ error: errorMessage }, 503);
    }

    if (error instanceof UnsupportedResponseFeatureError) {
      return c.json({ error: errorMessage }, 422);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

responsesRouter.get("/:id", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const id = c.req.param("id");

  try {
    const response = await handleResponseRetrieve(id, apiKeyId);
    return c.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (error instanceof OpenAIResponseProviderNotConfiguredError) {
      return c.json({ error: errorMessage }, 503);
    }

    if (error instanceof UnsupportedResponseFeatureError) {
      return c.json({ error: errorMessage }, 422);
    }

    if (error instanceof RequestLoggingUnavailableError) {
      return c.json({ error: errorMessage }, 503);
    }

    if (errorMessage.startsWith("OpenAI Responses API error: 404")) {
      return c.json({ error: errorMessage }, 404);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

type ResponseStreamUsageObserver = {
  buffer: string;
  usage?: ResponseUsage;
};

function createResponseStreamUsageObserver(): ResponseStreamUsageObserver {
  return { buffer: "" };
}

function observeResponseStreamUsage(chunk: string, observer: ResponseStreamUsageObserver): void {
  observer.buffer += chunk;

  while (true) {
    const eventBlock = shiftSseEventBlock(observer);
    if (eventBlock === null) return;
    const usage = extractResponseCompletedUsage(eventBlock);
    if (usage) observer.usage = usage;
  }
}

function shiftSseEventBlock(observer: ResponseStreamUsageObserver): string | null {
  const lfIndex = observer.buffer.indexOf("\n\n");
  const crlfIndex = observer.buffer.indexOf("\r\n\r\n");
  const indexes = [lfIndex, crlfIndex].filter((index) => index >= 0);
  if (indexes.length === 0) return null;

  const delimiterIndex = Math.min(...indexes);
  const delimiterLength = observer.buffer.startsWith("\r\n\r\n", delimiterIndex) ? 4 : 2;
  const eventBlock = observer.buffer.slice(0, delimiterIndex);
  observer.buffer = observer.buffer.slice(delimiterIndex + delimiterLength);
  return eventBlock;
}

function extractResponseCompletedUsage(eventBlock: string): ResponseUsage | undefined {
  const lines = eventBlock.split(/\r?\n/);
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const data = dataLines.join("\n");
  if (!data || data === "[DONE]") return undefined;

  try {
    const payload = JSON.parse(data) as {
      type?: string;
      response?: { usage?: ResponseUsage };
      usage?: ResponseUsage;
    };
    if (eventName !== "response.completed" && payload.type !== "response.completed") {
      return undefined;
    }
    return payload.response?.usage ?? payload.usage;
  } catch {
    return undefined;
  }
}
