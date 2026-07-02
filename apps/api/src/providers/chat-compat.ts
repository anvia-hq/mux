import type { ChatCompletionRequest, ChatContentPart, Model, ProviderCapabilities } from "./types";

export type ChatFeature =
  | "tools"
  | "structuredOutput"
  | "multimodalInput"
  | "audioOutput"
  | "reasoning"
  | "logprobs";

export const openAICompatibleCapabilities: ProviderCapabilities = {
  tools: true,
  structuredOutput: true,
  multimodalInput: true,
  audioOutput: true,
  reasoning: true,
  logprobs: true,
  openAICompatiblePassthrough: true,
  responsesApi: true,
  embeddingsApi: true,
};

export const anthropicCapabilities: ProviderCapabilities = {
  tools: true,
  structuredOutput: false,
  multimodalInput: true,
  audioOutput: false,
  reasoning: false,
  logprobs: false,
  openAICompatiblePassthrough: false,
};

export const googleCapabilities: ProviderCapabilities = {
  tools: true,
  structuredOutput: true,
  multimodalInput: true,
  audioOutput: false,
  reasoning: false,
  logprobs: false,
  openAICompatiblePassthrough: false,
};

export const unsupportedNativeCapabilities: ProviderCapabilities = {
  tools: false,
  structuredOutput: false,
  multimodalInput: false,
  audioOutput: false,
  reasoning: false,
  logprobs: false,
  openAICompatiblePassthrough: false,
};

export class UnsupportedChatFeatureError extends Error {
  constructor(
    readonly model: string,
    readonly features: ChatFeature[],
  ) {
    super(`Model ${model} does not support requested feature(s): ${features.join(", ")}`);
    this.name = "UnsupportedChatFeatureError";
  }
}

export function requestedChatFeatures(request: ChatCompletionRequest): Set<ChatFeature> {
  const features = new Set<ChatFeature>();

  if (
    request.tools?.length ||
    request.tool_choice !== undefined ||
    request.parallel_tool_calls !== undefined ||
    request.messages.some((message) => message.role === "tool" || message.tool_calls?.length)
  ) {
    features.add("tools");
  }

  if (request.response_format && request.response_format.type !== "text") {
    features.add("structuredOutput");
  }

  if (
    request.messages.some((message) =>
      Array.isArray(message.content) ? message.content.some((part) => part.type !== "text") : false,
    )
  ) {
    features.add("multimodalInput");
  }

  if (request.modalities?.includes("audio") || request.audio) {
    features.add("audioOutput");
  }

  if (request.reasoning_effort !== undefined) {
    features.add("reasoning");
  }

  if (request.logprobs !== undefined || request.top_logprobs !== undefined) {
    features.add("logprobs");
  }

  return features;
}

export function unsupportedChatFeatures(
  request: ChatCompletionRequest,
  model: Model,
  capabilities: ProviderCapabilities,
): ChatFeature[] {
  const requested = requestedChatFeatures(request);
  const unsupported: ChatFeature[] = [];

  for (const feature of requested) {
    if (!capabilities[feature]) {
      unsupported.push(feature);
    }
  }

  if (requested.has("tools") && !model.toolCall) {
    unsupported.push("tools");
  }
  if (requested.has("structuredOutput") && !model.structuredOutput) {
    unsupported.push("structuredOutput");
  }
  if (
    requested.has("multimodalInput") &&
    !request.messages.every((message) =>
      Array.isArray(message.content)
        ? message.content.every((part) => part.type === "text" || supportsInputPart(model, part))
        : true,
    )
  ) {
    unsupported.push("multimodalInput");
  }
  if (requested.has("audioOutput") && !model.outputModalities.includes("audio")) {
    unsupported.push("audioOutput");
  }
  if (requested.has("reasoning") && !model.reasoning) {
    unsupported.push("reasoning");
  }

  return Array.from(new Set(unsupported));
}

export function assertChatFeaturesSupported(
  request: ChatCompletionRequest,
  model: Model,
  publicModelId: string,
  capabilities: ProviderCapabilities,
): void {
  const unsupported = unsupportedChatFeatures(request, model, capabilities);
  if (unsupported.length > 0) {
    throw new UnsupportedChatFeatureError(publicModelId, unsupported);
  }
}

export function applyRuntimeCapabilities(model: Model, capabilities: ProviderCapabilities): Model {
  const inputModalities = capabilities.multimodalInput
    ? model.inputModalities
    : model.inputModalities.filter((modality) => modality === "text");
  const outputModalities = model.outputModalities.filter(
    (modality) => modality === "text" || (modality === "audio" && capabilities.audioOutput),
  );

  return {
    ...model,
    inputModalities,
    outputModalities,
    toolCall: model.toolCall && capabilities.tools,
    structuredOutput: model.structuredOutput && capabilities.structuredOutput,
    reasoning: model.reasoning && capabilities.reasoning,
  };
}

export function buildOpenAICompatibleRequestBody(
  request: ChatCompletionRequest,
  stream: boolean,
): string {
  const body = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    max_completion_tokens: request.max_completion_tokens,
    stream,
    stream_options: stream
      ? { ...request.stream_options, include_usage: request.stream_options?.include_usage ?? true }
      : undefined,
    tools: request.tools,
    tool_choice: request.tool_choice,
    parallel_tool_calls: request.parallel_tool_calls,
    response_format: request.response_format,
    top_p: request.top_p,
    stop: request.stop,
    n: request.n,
    seed: request.seed,
    frequency_penalty: request.frequency_penalty,
    presence_penalty: request.presence_penalty,
    logit_bias: request.logit_bias,
    logprobs: request.logprobs,
    top_logprobs: request.top_logprobs,
    user: request.user,
    metadata: request.metadata,
    store: request.store,
    service_tier: request.service_tier,
    reasoning_effort: request.reasoning_effort,
    modalities: request.modalities,
    audio: request.audio,
  } satisfies Record<keyof ChatCompletionRequest, unknown>;

  return JSON.stringify(body);
}

export function validateChatCompletionRequestShape(value: unknown): string | null {
  if (!value || typeof value !== "object") return "request body must be an object";
  const request = value as Partial<ChatCompletionRequest>;
  if (typeof request.model !== "string" || request.model.length === 0) {
    return "request must include a model";
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return "request must include a non-empty messages array";
  }

  for (const [index, message] of request.messages.entries()) {
    if (!message || typeof message !== "object") {
      return `messages[${index}] must be an object`;
    }
    if (!["system", "user", "assistant", "tool"].includes(message.role)) {
      return `messages[${index}].role is invalid`;
    }
    if (message.role === "tool" && typeof message.tool_call_id !== "string") {
      return `messages[${index}].tool_call_id is required for tool messages`;
    }
    if (message.tool_calls !== undefined && !isValidToolCalls(message.tool_calls)) {
      return `messages[${index}].tool_calls is invalid`;
    }
    if (!isValidMessageContent(message)) {
      return `messages[${index}].content is invalid`;
    }
  }

  if (
    request.tools !== undefined &&
    (!Array.isArray(request.tools) ||
      !request.tools.every(
        (tool) => tool?.type === "function" && typeof tool.function?.name === "string",
      ))
  ) {
    return "tools must be an array of function tools";
  }

  if (
    request.response_format !== undefined &&
    !["text", "json_object", "json_schema"].includes(request.response_format.type)
  ) {
    return "response_format.type is invalid";
  }

  if (
    request.modalities !== undefined &&
    (!Array.isArray(request.modalities) ||
      !request.modalities.every((modality) => modality === "text" || modality === "audio"))
  ) {
    return "modalities must contain only text or audio";
  }

  return null;
}

function supportsInputPart(model: Model, part: ChatContentPart): boolean {
  if (part.type === "image_url") return model.inputModalities.includes("image");
  if (part.type === "input_audio") return model.inputModalities.includes("audio");
  if (part.type === "file") return model.inputModalities.includes("pdf");
  return true;
}

function isValidToolCalls(
  toolCalls: unknown,
): toolCalls is NonNullable<ChatCompletionRequest["messages"][number]["tool_calls"]> {
  return (
    Array.isArray(toolCalls) &&
    toolCalls.every(
      (toolCall) =>
        toolCall?.type === "function" &&
        typeof toolCall.id === "string" &&
        typeof toolCall.function?.name === "string" &&
        typeof toolCall.function?.arguments === "string",
    )
  );
}

function isValidMessageContent(message: ChatCompletionRequest["messages"][number]): boolean {
  const content = message.content;
  if (content === undefined) {
    return message.role === "assistant" && Boolean(message.tool_calls?.length);
  }
  if (typeof content === "string" || content === null) return true;
  if (!Array.isArray(content)) return false;
  return content.every((part) => {
    if (!part || typeof part !== "object") return false;
    if (part.type === "text") return typeof part.text === "string";
    if (part.type === "refusal") return typeof part.refusal === "string";
    if (part.type === "image_url") return typeof part.image_url?.url === "string";
    if (part.type === "input_audio")
      return (
        typeof part.input_audio?.data === "string" && typeof part.input_audio?.format === "string"
      );
    if (part.type === "file") return Boolean(part.file?.file_id || part.file?.file_data);
    return false;
  });
}
