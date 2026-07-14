import type { ChatCompletionRequest, ChatContentPart, Model, ProviderCapabilities } from "./types";

const maxOpenAICompatibleTokens = Math.floor(2_147_483_647 / 2);

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
  moderationsApi: true,
  imageGenerationsApi: true,
  completionsApi: true,
  audioTranscriptionsApi: true,
  audioTranslationsApi: true,
  audioSpeechApi: true,
};

export const anthropicCapabilities: ProviderCapabilities = {
  tools: true,
  structuredOutput: false,
  responseFormats: ["text"],
  multimodalInput: true,
  audioOutput: false,
  reasoning: false,
  logprobs: false,
  openAICompatiblePassthrough: false,
  anthropicMessagesApi: true,
  anthropicMessageTokenCountingApi: true,
};

export const googleCapabilities: ProviderCapabilities = {
  tools: true,
  structuredOutput: true,
  responseFormats: ["text", "json_object", "json_schema"],
  multimodalInput: true,
  audioOutput: false,
  reasoning: false,
  logprobs: false,
  openAICompatiblePassthrough: false,
};

export const unsupportedNativeCapabilities: ProviderCapabilities = {
  tools: false,
  structuredOutput: false,
  responseFormats: ["text"],
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
  const messages = Array.isArray(request.messages) ? request.messages : [];

  if (
    request.tools?.length ||
    Array.isArray(request.functions) ||
    request.function_call !== undefined ||
    request.tool_choice !== undefined ||
    request.parallel_tool_calls !== undefined ||
    messages.some((message) => message.role === "tool" || message.tool_calls?.length)
  ) {
    features.add("tools");
  }

  if (request.response_format && request.response_format.type !== "text") {
    features.add("structuredOutput");
  }

  if (
    messages.some((message) =>
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
  const messages = Array.isArray(request.messages) ? request.messages : [];

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
    request.response_format &&
    capabilities.responseFormats &&
    !capabilities.responseFormats.includes(request.response_format.type)
  ) {
    unsupported.push("structuredOutput");
  }
  if (
    requested.has("multimodalInput") &&
    !messages.every((message) =>
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
  const body: Record<string, unknown> = {
    ...request,
    model: request.model,
  };

  normalizeOpenAIReasoningModelRequest(body);

  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  } else {
    if (request.stream !== undefined) {
      body.stream = request.stream;
    } else {
      delete body.stream;
    }
    delete body.stream_options;
  }

  return JSON.stringify(body);
}

function normalizeOpenAIReasoningModelRequest(body: Record<string, unknown>): void {
  if (typeof body.model !== "string") return;

  const originalModel = body.model;
  const isOModel = isOpenAIReasoningOModel(originalModel);
  const isGPT5Model = isOpenAIGPT5Model(originalModel);
  if (!isOModel && !isGPT5Model) return;

  if (
    (body.max_completion_tokens === undefined ||
      body.max_completion_tokens === null ||
      body.max_completion_tokens === 0) &&
    typeof body.max_tokens === "number" &&
    body.max_tokens !== 0
  ) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }

  if (isOModel) {
    delete body.temperature;
  }

  if (isGPT5Model) {
    delete body.temperature;
    delete body.top_p;
    delete body.logprobs;
  }

  const parsed = parseOpenAIReasoningEffortFromModelSuffix(originalModel);
  if (parsed) {
    body.reasoning_effort = parsed.effort;
    body.model = parsed.model;
  }

  if (shouldUseDeveloperRoleForOpenAIReasoningModel(String(body.model))) {
    convertFirstSystemMessageToDeveloper(body);
  }
}

function isOpenAIReasoningOModel(model: string): boolean {
  return model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4");
}

function isOpenAIGPT5Model(model: string): boolean {
  return model.startsWith("gpt-5");
}

function parseOpenAIReasoningEffortFromModelSuffix(
  model: string,
): { effort: string; model: string } | null {
  const suffixes = ["-high", "-minimal", "-low", "-medium", "-none", "-xhigh"];
  const suffix = suffixes.find((item) => model.endsWith(item));
  if (!suffix) return null;

  return {
    effort: suffix.slice(1),
    model: model.slice(0, -suffix.length),
  };
}

function shouldUseDeveloperRoleForOpenAIReasoningModel(model: string): boolean {
  if (model.startsWith("o1-mini") || model.startsWith("o1-preview")) return false;
  return isOpenAIReasoningOModel(model) || isOpenAIGPT5Model(model);
}

function convertFirstSystemMessageToDeveloper(body: Record<string, unknown>): void {
  if (!Array.isArray(body.messages)) return;

  const [firstMessage, ...restMessages] = body.messages;
  if (!firstMessage || typeof firstMessage !== "object") return;
  if ((firstMessage as { role?: unknown }).role !== "system") return;

  body.messages = [{ ...firstMessage, role: "developer" }, ...restMessages];
}

export function validateChatCompletionRequestShape(value: unknown): string | null {
  if (!isJsonObject(value)) return "request body must be an object";
  const request = value as Partial<ChatCompletionRequest>;
  if (typeof request.model !== "string" || request.model.length === 0) {
    return "request must include a model";
  }
  if (typeof request.max_tokens === "number" && request.max_tokens > maxOpenAICompatibleTokens) {
    return "max_tokens is invalid";
  }
  if (request.messages !== undefined && !Array.isArray(request.messages)) {
    return "messages must be an array";
  }
  const responseFormatError = validateResponseFormat(value);
  if (responseFormatError) {
    return responseFormatError;
  }
  const webSearchOptionsError = normalizeWebSearchOptions(request as Record<string, unknown>);
  if (webSearchOptionsError) {
    return webSearchOptionsError;
  }

  const messages = Array.isArray(request.messages) ? request.messages : [];
  const hasFimInput = hasNonNilField(request, "prefix") || hasNonNilField(request, "suffix");

  if (messages.length === 0 && !hasFimInput) {
    return "request must include a non-empty messages array or prefix/suffix";
  }

  for (const [index, message] of messages.entries()) {
    if (!message || typeof message !== "object") {
      return `messages[${index}] must be an object`;
    }
  }

  return null;
}

function validateResponseFormat(request: Record<string, unknown>): string | null {
  if (!Object.hasOwn(request, "response_format") || request.response_format === undefined) {
    return null;
  }

  if (!isJsonObject(request.response_format)) {
    return "response_format must be an object";
  }

  const responseFormat = request.response_format;
  if (typeof responseFormat.type !== "string" || responseFormat.type.length === 0) {
    return "response_format.type must be a non-empty string";
  }
  if (responseFormat.type !== "json_schema") {
    return null;
  }

  if (!isJsonObject(responseFormat.json_schema)) {
    return "response_format.json_schema must be an object";
  }

  const jsonSchema = responseFormat.json_schema;
  if (typeof jsonSchema.name !== "string" || jsonSchema.name.length === 0) {
    return "response_format.json_schema.name must be a non-empty string";
  }
  if (!isJsonObject(jsonSchema.schema)) {
    return "response_format.json_schema.schema must be an object";
  }
  if (jsonSchema.description !== undefined && typeof jsonSchema.description !== "string") {
    return "response_format.json_schema.description must be a string";
  }
  if (jsonSchema.strict !== undefined && typeof jsonSchema.strict !== "boolean") {
    return "response_format.json_schema.strict must be a boolean";
  }

  return null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasNonNilField(
  request: Partial<ChatCompletionRequest>,
  key: "prefix" | "suffix",
): boolean {
  return Object.hasOwn(request, key) && request[key] !== null;
}

function normalizeWebSearchOptions(request: Record<string, unknown>): string | null {
  if (request.web_search_options === undefined || request.web_search_options === null) {
    return null;
  }

  if (typeof request.web_search_options !== "object" || Array.isArray(request.web_search_options)) {
    return "web_search_options must be an object";
  }

  const webSearchOptions = request.web_search_options as Record<string, unknown>;
  const searchContextSize = webSearchOptions.search_context_size;
  if (searchContextSize === undefined || searchContextSize === "") {
    webSearchOptions.search_context_size = "medium";
    return null;
  }

  if (
    searchContextSize !== "high" &&
    searchContextSize !== "medium" &&
    searchContextSize !== "low"
  ) {
    return "invalid search_context_size, must be one of: high, medium, low";
  }

  return null;
}

function supportsInputPart(model: Model, part: ChatContentPart): boolean {
  if (part.type === "image_url") return model.inputModalities.includes("image");
  if (part.type === "input_audio") return model.inputModalities.includes("audio");
  if (part.type === "file") return model.inputModalities.includes("pdf");
  return true;
}
