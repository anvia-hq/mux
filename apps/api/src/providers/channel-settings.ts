import type {
  ChatCompletionRequest,
  ChatMessage,
  ResponseCompactRequest,
  ResponseCreateRequest,
} from "./types";
import {
  applyChannelOverrides,
  resolveChannelHeaders,
  type ChannelOverrideRequestContext,
  type ChannelOverrideRuntime,
} from "./channel-overrides";

export type ChannelSettings = {
  passThroughBodyEnabled?: boolean;
  systemPrompt?: string;
  systemPromptOverride?: boolean;
};

export type ChannelOtherSettings = {
  allowServiceTier?: boolean;
  allowSafetyIdentifier?: boolean;
  disableStore?: boolean;
  allowIncludeObfuscation?: boolean;
};

export type ChannelRequestRuntime = ChannelOverrideRuntime & {
  settings?: ChannelSettings;
  otherSettings?: ChannelOtherSettings;
};

export type PreparedChannelRequest<T extends Record<string, unknown>> = {
  body: T;
  headers: Record<string, string>;
};

export function normalizeJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function normalizeStringMap(value: unknown): Record<string, string> {
  const object = normalizeJsonObject(value);
  if (!object) return {};

  const result: Record<string, string> = {};
  for (const [key, mapped] of Object.entries(object)) {
    if (typeof mapped === "string" && mapped.length > 0) {
      result[key] = mapped;
    }
  }
  return result;
}

export function normalizeChannelSettings(value: unknown): ChannelSettings | undefined {
  const object = normalizeJsonObject(value);
  if (!object) return undefined;

  return {
    passThroughBodyEnabled: readBoolean(object.passThroughBodyEnabled),
    systemPrompt: readString(object.systemPrompt),
    systemPromptOverride: readBoolean(object.systemPromptOverride),
  };
}

export function normalizeChannelOtherSettings(value: unknown): ChannelOtherSettings | undefined {
  const object = normalizeJsonObject(value);
  if (!object) return undefined;

  return {
    allowServiceTier: readBoolean(object.allowServiceTier),
    allowSafetyIdentifier: readBoolean(object.allowSafetyIdentifier),
    disableStore: readBoolean(object.disableStore),
    allowIncludeObfuscation: readBoolean(object.allowIncludeObfuscation),
  };
}

export function applyChannelChatRequestSettings(
  request: ChatCompletionRequest,
  channel: ChannelRequestRuntime,
): ChatCompletionRequest {
  return prepareChannelChatRequestSettings(request, channel).body;
}

export function prepareChannelChatRequestSettings(
  request: ChatCompletionRequest,
  channel: ChannelRequestRuntime,
  context: ChannelOverrideRequestContext = {},
): PreparedChannelRequest<ChatCompletionRequest> {
  const body: ChatCompletionRequest = {
    ...request,
    messages: Array.isArray(request.messages)
      ? request.messages.map((message) => ({ ...message }))
      : [],
  };

  if (!channel.settings?.passThroughBodyEnabled) {
    applySystemPrompt(body, channel.settings);
    removeDisabledOpenAICompatibleFields(body, channel.otherSettings);
    return applyChannelOverrides(body, channel, runtimeContext(body, channel, context));
  }

  return {
    body,
    headers: resolveChannelHeaders(channel, runtimeContext(body, channel, context)),
  };
}

export function applyChannelResponseRequestSettings<T extends ResponseCreateRequest>(
  request: T,
  channel: ChannelRequestRuntime,
): T {
  return prepareChannelResponseRequestSettings(request, channel).body;
}

export function prepareChannelOpenAICompatibleRequestSettings<
  T extends { model: string } & Record<string, unknown>,
>(
  request: T,
  channel: ChannelRequestRuntime,
  context: ChannelOverrideRequestContext = {},
): PreparedChannelRequest<T> {
  const body = { ...request } as T;

  if (!channel.settings?.passThroughBodyEnabled) {
    removeDisabledOpenAICompatibleFields(body, channel.otherSettings);
    return applyChannelOverrides(body, channel, runtimeContext(body, channel, context));
  }

  return {
    body,
    headers: resolveChannelHeaders(channel, runtimeContext(body, channel, context)),
  };
}

export function prepareChannelResponseRequestSettings<T extends ResponseCreateRequest>(
  request: T,
  channel: ChannelRequestRuntime,
  context: ChannelOverrideRequestContext = {},
): PreparedChannelRequest<T> {
  const body = { ...request } as T;

  if (!channel.settings?.passThroughBodyEnabled) {
    removeDisabledOpenAICompatibleFields(body, channel.otherSettings);
    return applyChannelOverrides(body, channel, runtimeContext(body, channel, context));
  }

  return {
    body,
    headers: resolveChannelHeaders(channel, runtimeContext(body, channel, context)),
  };
}

export function applyChannelCompactRequestSettings(
  request: ResponseCompactRequest,
  channel: ChannelRequestRuntime,
): ResponseCompactRequest {
  return prepareChannelCompactRequestSettings(request, channel).body;
}

export function prepareChannelCompactRequestSettings(
  request: ResponseCompactRequest,
  channel: ChannelRequestRuntime,
  context: ChannelOverrideRequestContext = {},
): PreparedChannelRequest<ResponseCompactRequest> {
  const body = { ...request };

  if (!channel.settings?.passThroughBodyEnabled) {
    removeDisabledOpenAICompatibleFields(body, channel.otherSettings);
    return applyChannelOverrides(body, channel, runtimeContext(body, channel, context));
  }

  return {
    body,
    headers: resolveChannelHeaders(channel, runtimeContext(body, channel, context)),
  };
}

function runtimeContext(
  body: Record<string, unknown>,
  channel: ChannelRequestRuntime,
  context: ChannelOverrideRequestContext,
): ChannelOverrideRequestContext {
  return {
    ...context,
    apiKey: context.apiKey ?? channel.apiKey,
    upstreamModel:
      context.upstreamModel ?? (typeof body.model === "string" ? body.model : undefined),
  };
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function applySystemPrompt(request: ChatCompletionRequest, settings: ChannelSettings | undefined) {
  const prompt = settings?.systemPrompt;
  if (!prompt) return;

  const role = systemPromptRoleForModel(request.model);
  const index = request.messages.findIndex((message) => message.role === role);
  if (index === -1) {
    request.messages = [{ role, content: prompt }, ...request.messages];
    return;
  }

  if (!settings.systemPromptOverride) {
    return;
  }

  request.messages[index] = prependMessageContent(request.messages[index], prompt);
}

function systemPromptRoleForModel(model: string): "system" | "developer" {
  if (model.startsWith("o1-mini") || model.startsWith("o1-preview")) return "system";
  if (
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4") ||
    model.startsWith("gpt-5")
  ) {
    return "developer";
  }
  return "system";
}

function prependMessageContent(message: ChatMessage, prompt: string): ChatMessage {
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: [{ type: "text", text: `${prompt}\n\n` }, ...message.content],
    };
  }

  if (typeof message.content === "string" && message.content.length > 0) {
    return { ...message, content: `${prompt}\n\n${message.content}` };
  }

  return { ...message, content: prompt };
}

function removeDisabledOpenAICompatibleFields(
  body: Record<string, unknown>,
  settings: ChannelOtherSettings | undefined,
): void {
  if (!settings?.allowServiceTier) {
    delete body.service_tier;
  }
  if (!settings?.allowSafetyIdentifier) {
    delete body.safety_identifier;
  }
  if (settings?.disableStore) {
    delete body.store;
  }

  if (!settings?.allowIncludeObfuscation) {
    const streamOptions = normalizeJsonObject(body.stream_options);
    if (streamOptions) {
      delete streamOptions.include_obfuscation;
      if (Object.keys(streamOptions).length === 0) {
        delete body.stream_options;
      }
    }
  }
}
