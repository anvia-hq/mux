import { randomUUID } from "node:crypto";
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatTool,
  ChatToolChoice,
  ResponseCreateRequest,
  ResponseObject,
  ToolCall,
} from "./types";

export class UnsupportedResponseConversionError extends Error {
  constructor(
    readonly field: string,
    message = `${field} is not supported by chat-converted Responses`,
  ) {
    super(message);
    this.name = "UnsupportedResponseConversionError";
  }
}

type ConversionOptions = { googleCompatible?: boolean };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}

function callId(item: Record<string, unknown>): string {
  return typeof item.call_id === "string"
    ? item.call_id
    : typeof item.id === "string"
      ? item.id
      : `call_${randomUUID().replaceAll("-", "")}`;
}

function contentPart(part: unknown) {
  const value = record(part);
  if (!value) return { type: "text" as const, text: text(part) };
  const type = value.type;
  if (["input_text", "output_text", "text"].includes(String(type))) {
    return { type: "text" as const, text: text(value.text) };
  }
  if (type === "input_image" || type === "image_url") {
    const source = record(value.image_url)?.url ?? value.image_url ?? value.url ?? value.file_id;
    return {
      type: "image_url" as const,
      image_url: { url: text(source), detail: value.detail as never },
    };
  }
  if (type === "input_file" || type === "file") {
    return {
      type: "file" as const,
      file: {
        file_id: typeof value.file_id === "string" ? value.file_id : undefined,
        filename: typeof value.filename === "string" ? value.filename : undefined,
        file_data: typeof value.file_data === "string" ? value.file_data : undefined,
      },
    };
  }
  if (type === "input_audio") {
    const audio = record(value.input_audio) ?? value;
    return {
      type: "input_audio" as const,
      input_audio: { data: text(audio.data), format: text(audio.format || "wav") },
    };
  }
  if (type === "input_video" || type === "video_url") {
    const source = record(value.video_url)?.url ?? value.video_url ?? value.url;
    return { type: "video_url" as const, video_url: { url: text(source) } };
  }
  if (type === undefined && typeof value.text === "string") {
    return { type: "text" as const, text: value.text };
  }
  throw new UnsupportedResponseConversionError(`input.content.${String(type ?? "unknown")}`);
}

function messageContent(value: unknown): ChatMessage["content"] {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return text(value);
  const parts = value.map(contentPart);
  return parts.every((part) => part.type === "text")
    ? parts.map((part) => (part.type === "text" ? part.text : "")).join("")
    : parts;
}

function responseTools(value: unknown, googleCompatible: boolean): ChatTool[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools: ChatTool[] = [];
  for (const item of value) {
    const tool = record(item);
    if (!tool) throw new UnsupportedResponseConversionError("tools");
    if (tool.type !== "function") {
      if (googleCompatible && tool.type === "custom") continue;
      throw new UnsupportedResponseConversionError(`tools.${String(tool.type ?? "unknown")}`);
    }
    const fn = record(tool.function) ?? tool;
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) throw new UnsupportedResponseConversionError("tools.function.name");
    tools.push({
      type: "function",
      function: {
        name,
        description: typeof fn.description === "string" ? fn.description : undefined,
        parameters: record(fn.parameters) ?? undefined,
        strict: typeof fn.strict === "boolean" ? fn.strict : undefined,
      },
    });
  }
  return tools.length > 0 ? tools : undefined;
}

function responseToolChoice(value: unknown): ChatToolChoice | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "none" || value === "auto" || value === "required") return value;
  const choice = record(value);
  if (choice?.type !== "function") {
    throw new UnsupportedResponseConversionError("tool_choice");
  }
  const fn = record(choice.function) ?? choice;
  if (typeof fn.name !== "string") {
    throw new UnsupportedResponseConversionError("tool_choice.function.name");
  }
  return { type: "function", function: { name: fn.name } };
}

function responseFormat(value: unknown): ChatCompletionRequest["response_format"] {
  const textConfig = record(value);
  const format = record(textConfig?.format);
  if (!format || format.type === "text") return format ? { type: "text" } : undefined;
  if (format.type === "json_object") return { type: "json_object" };
  if (format.type === "json_schema") {
    return {
      type: "json_schema",
      json_schema: {
        name: typeof format.name === "string" ? format.name : "response",
        description: typeof format.description === "string" ? format.description : undefined,
        schema: record(format.schema) ?? {},
        strict: typeof format.strict === "boolean" ? format.strict : undefined,
      },
    };
  }
  throw new UnsupportedResponseConversionError(`text.format.${String(format.type)}`);
}

export function responseRequestToChat(
  request: ResponseCreateRequest,
  options: ConversionOptions = {},
): ChatCompletionRequest {
  for (const field of [
    "conversation",
    "previous_response_id",
    "prompt",
    "context_management",
  ] as const) {
    if (request[field] !== undefined && request[field] !== null) {
      throw new UnsupportedResponseConversionError(field);
    }
  }

  const messages: ChatMessage[] = [];
  if (request.instructions) messages.push({ role: "system", content: text(request.instructions) });
  if (typeof request.input === "string") {
    messages.push({ role: "user", content: request.input });
  } else if (Array.isArray(request.input)) {
    for (const raw of request.input) {
      const item = record(raw);
      if (!item) {
        messages.push({ role: "user", content: text(raw) });
        continue;
      }
      const type = String(item.type ?? "message");
      if (
        options.googleCompatible &&
        ["custom_tool_call", "custom_tool_call_output"].includes(type)
      ) {
        continue;
      }
      if (type === "custom_tool_call" || type === "custom_tool_call_output") {
        throw new UnsupportedResponseConversionError(`input.${type}`);
      }
      if (type === "function_call") {
        if (typeof item.name !== "string" || !item.name) {
          throw new UnsupportedResponseConversionError("input.function_call.name");
        }
        const id = callId(item);
        const call: ToolCall = {
          id,
          type: "function",
          function: {
            name: item.name,
            arguments: text(item.arguments ?? item.input ?? ""),
          },
        };
        const previous = messages.at(-1);
        if (previous?.role === "assistant")
          previous.tool_calls = [...(previous.tool_calls ?? []), call];
        else messages.push({ role: "assistant", content: null, tool_calls: [call] });
        continue;
      }
      if (type === "function_call_output") {
        if (typeof item.call_id !== "string" && typeof item.id !== "string") {
          throw new UnsupportedResponseConversionError("input.function_call_output.call_id");
        }
        const id = callId(item);
        messages.push({ role: "tool", tool_call_id: id, content: text(item.output) });
        continue;
      }
      if (type === "item_reference")
        throw new UnsupportedResponseConversionError("input.item_reference");
      if (type !== "message") {
        throw new UnsupportedResponseConversionError(`input.${type}`);
      }
      const role = typeof item.role === "string" ? item.role : "user";
      messages.push({ role, content: messageContent(item.content ?? item) });
    }
  } else if (request.input !== undefined && request.input !== null) {
    throw new UnsupportedResponseConversionError("input");
  }

  if (messages.length === 0) messages.push({ role: "user", content: "" });
  const reasoning = record(request.reasoning);
  const result: ChatCompletionRequest = {
    model: request.model,
    messages,
    stream: request.stream,
    tools: responseTools(request.tools, options.googleCompatible === true),
    tool_choice: responseToolChoice(request.tool_choice),
    parallel_tool_calls:
      typeof request.parallel_tool_calls === "boolean" ? request.parallel_tool_calls : undefined,
    response_format: responseFormat(request.text),
    max_completion_tokens:
      typeof request.max_output_tokens === "number" ? request.max_output_tokens : undefined,
    temperature: typeof request.temperature === "number" ? request.temperature : undefined,
    top_p: typeof request.top_p === "number" ? request.top_p : undefined,
    top_logprobs: typeof request.top_logprobs === "number" ? request.top_logprobs : undefined,
    reasoning_effort:
      reasoning && typeof reasoning.effort === "string" ? (reasoning.effort as never) : undefined,
    metadata: record(request.metadata) ?? undefined,
    store: typeof request.store === "boolean" ? request.store : undefined,
    service_tier: request.service_tier as never,
    stream_options: record(request.stream_options) ?? undefined,
    user: typeof request.user === "string" ? request.user : undefined,
  };
  for (const field of [
    "safety_identifier",
    "prompt_cache_key",
    "prompt_cache_retention",
    "enable_thinking",
  ] as const) {
    if (request[field] !== undefined) result[field] = request[field];
  }
  return result;
}

function responseId(id?: string): string {
  return id?.startsWith("resp_")
    ? id
    : `resp_${(id || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function statusForFinish(finish: string | null | undefined) {
  return finish === "length" || finish === "content_filter" ? "incomplete" : "completed";
}

function incompleteDetails(finish: string | null | undefined) {
  if (finish === "length") return { reason: "max_output_tokens" };
  if (finish === "content_filter") return { reason: "content_filter" };
  return undefined;
}

export function chatResponseToResponse(
  chat: ChatCompletionResponse,
  publicModel: string,
): ResponseObject {
  const id = responseId(chat.id);
  const choice = chat.choices[0];
  const status = statusForFinish(choice?.finish_reason);
  const message = choice?.message;
  const output: unknown[] = [];
  const content = typeof message?.content === "string" ? message.content : "";
  const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
  if (content) {
    output.push({
      id: `${id}_msg_0`,
      type: "message",
      role: "assistant",
      status,
      content: [{ type: "output_text", text: content, annotations: [] }],
    });
  }
  if (reasoning) {
    output.push({
      id: `${id}_reasoning_0`,
      type: "reasoning",
      status,
      summary: [{ type: "summary_text", text: reasoning }],
    });
  }
  for (const call of message?.tool_calls ?? []) {
    output.push({
      id: call.id,
      call_id: call.id,
      type: "function_call",
      status,
      name: call.function.name,
      arguments: call.function.arguments,
    });
  }
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1_000),
    status,
    incomplete_details: incompleteDetails(choice?.finish_reason),
    model: publicModel,
    output,
    usage: {
      input_tokens: chat.usage?.prompt_tokens ?? 0,
      output_tokens: chat.usage?.completion_tokens ?? 0,
      total_tokens: chat.usage?.total_tokens ?? 0,
    },
  } as ResponseObject;
}

function sse(type: string, payload: Record<string, unknown>, sequence: number): string {
  return `event: ${type}\ndata: ${JSON.stringify({ ...payload, type, sequence_number: sequence })}\n\n`;
}

export async function* chatStreamToResponses(
  source: AsyncIterable<ChatCompletionChunk>,
  publicModel: string,
): AsyncIterable<string> {
  const iterator = source[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) throw new Error("Upstream chat stream ended before its first event");
  const id = responseId(first.value.id);
  const created = Math.floor(Date.now() / 1_000);
  let sequence = 0;
  let textOutput = "";
  let reasoningOutput = "";
  let textStarted = false;
  let reasoningStarted = false;
  let textOutputIndex = -1;
  let reasoningOutputIndex = -1;
  let finishReason: string | null = null;
  let usage: ChatCompletionChunk["usage"];
  const tools = new Map<
    number,
    { id: string; name: string; arguments: string; outputIndex: number }
  >();
  let nextOutputIndex = 0;

  try {
    yield sse(
      "response.created",
      {
        response: {
          id,
          object: "response",
          created_at: created,
          status: "in_progress",
          model: publicModel,
          output: [],
        },
      },
      sequence++,
    );

    async function* process(chunk: ChatCompletionChunk): AsyncIterable<string> {
      if (chunk.usage) usage = chunk.usage;
      for (const choice of chunk.choices) {
        const delta = choice.delta as typeof choice.delta & { reasoning_content?: unknown };
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          if (!reasoningStarted) {
            reasoningStarted = true;
            reasoningOutputIndex = nextOutputIndex;
            yield sse(
              "response.output_item.added",
              {
                output_index: reasoningOutputIndex,
                item: {
                  id: `${id}_reasoning_0`,
                  type: "reasoning",
                  status: "in_progress",
                  summary: [],
                },
              },
              sequence++,
            );
            nextOutputIndex += 1;
          }
          reasoningOutput += delta.reasoning_content;
          yield sse(
            "response.reasoning_summary_text.delta",
            {
              item_id: `${id}_reasoning_0`,
              output_index: reasoningOutputIndex,
              summary_index: 0,
              delta: delta.reasoning_content,
            },
            sequence++,
          );
        }
        if (typeof delta.content === "string" && delta.content) {
          if (!textStarted) {
            textStarted = true;
            textOutputIndex = nextOutputIndex;
            yield sse(
              "response.output_item.added",
              {
                output_index: textOutputIndex,
                item: {
                  id: `${id}_msg_0`,
                  type: "message",
                  role: "assistant",
                  status: "in_progress",
                  content: [],
                },
              },
              sequence++,
            );
            nextOutputIndex += 1;
          }
          textOutput += delta.content;
          yield sse(
            "response.output_text.delta",
            {
              item_id: `${id}_msg_0`,
              output_index: textOutputIndex,
              content_index: 0,
              delta: delta.content,
            },
            sequence++,
          );
        }
        for (const part of delta.tool_calls ?? []) {
          const index = part.index ?? 0;
          let tool = tools.get(index);
          if (!tool) {
            tool = {
              id: part.id ?? `call_${randomUUID().replaceAll("-", "")}`,
              name: part.function?.name ?? "",
              arguments: "",
              outputIndex: nextOutputIndex++,
            };
            tools.set(index, tool);
            yield sse(
              "response.output_item.added",
              {
                output_index: tool.outputIndex,
                item: {
                  id: tool.id,
                  call_id: tool.id,
                  type: "function_call",
                  status: "in_progress",
                  name: tool.name,
                  arguments: "",
                },
              },
              sequence++,
            );
          }
          if (part.function?.name) tool.name = part.function.name;
          if (part.function?.arguments) {
            tool.arguments += part.function.arguments;
            yield sse(
              "response.function_call_arguments.delta",
              {
                item_id: tool.id,
                output_index: tool.outputIndex,
                delta: part.function.arguments,
              },
              sequence++,
            );
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    }

    yield* process(first.value);
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      yield* process(next.value);
    }

    const status = statusForFinish(finishReason);
    const indexedOutput: Array<{ index: number; item: unknown }> = [];
    if (reasoningStarted) {
      const item = {
        id: `${id}_reasoning_0`,
        type: "reasoning",
        status,
        summary: [{ type: "summary_text", text: reasoningOutput }],
      };
      yield sse(
        "response.reasoning_summary_text.done",
        {
          item_id: item.id,
          output_index: reasoningOutputIndex,
          summary_index: 0,
          text: reasoningOutput,
        },
        sequence++,
      );
      yield sse(
        "response.output_item.done",
        { output_index: reasoningOutputIndex, item },
        sequence++,
      );
      indexedOutput.push({ index: reasoningOutputIndex, item });
    }
    if (textStarted) {
      const item = {
        id: `${id}_msg_0`,
        type: "message",
        role: "assistant",
        status,
        content: [{ type: "output_text", text: textOutput, annotations: [] }],
      };
      yield sse(
        "response.output_text.done",
        { item_id: item.id, output_index: textOutputIndex, content_index: 0, text: textOutput },
        sequence++,
      );
      yield sse("response.output_item.done", { output_index: textOutputIndex, item }, sequence++);
      indexedOutput.push({ index: textOutputIndex, item });
    }
    for (const tool of [...tools.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      const item = {
        id: tool.id,
        call_id: tool.id,
        type: "function_call",
        status,
        name: tool.name,
        arguments: tool.arguments,
      };
      yield sse(
        "response.function_call_arguments.done",
        { item_id: tool.id, output_index: tool.outputIndex, arguments: tool.arguments },
        sequence++,
      );
      yield sse("response.output_item.done", { output_index: tool.outputIndex, item }, sequence++);
      indexedOutput.push({ index: tool.outputIndex, item });
    }
    const output = indexedOutput.sort((a, b) => a.index - b.index).map(({ item }) => item);
    const response = {
      id,
      object: "response",
      created_at: created,
      status,
      incomplete_details: incompleteDetails(finishReason),
      model: publicModel,
      output,
      usage: {
        input_tokens: usage?.prompt_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
    };
    yield sse(
      status === "incomplete" ? "response.incomplete" : "response.completed",
      { response },
      sequence++,
    );
  } finally {
    try {
      await iterator.return?.();
    } catch {
      // The relay is already closing this converted stream.
    }
  }
}
