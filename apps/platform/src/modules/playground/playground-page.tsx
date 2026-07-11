import "@assistant-ui/react-markdown/styles/dot.css";

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  useThread,
  useThreadRuntime,
  type ChatModelAdapter,
  type ChatModelRunOptions,
  type ChatModelRunResult,
  type ThreadMessage,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { Message as AnviaCoreMessage } from "@anvia/core/completion";
import { uiMessagesToCoreMessages, type UIMessage } from "@anvia/core/ui";
import { fetchEventStream } from "@anvia/react";
import { PlayIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import remarkGfm from "remark-gfm";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/alert";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { apiBase } from "../../lib/api-client";
import { useApiKeysQuery, type ApiKey } from "../api-keys/hooks";
import { meQueryOptions } from "../auth/hooks/use-auth";
import { useModelsQuery, type Model } from "../models/hooks";

type PlaygroundCompletionRequest = {
  apiKeyId: string;
  model: string;
  messages: AnviaCoreMessage[];
  stream: true;
};

type AnviaUIMessagePart = UIMessage["parts"][number];

type PlaygroundStreamEvent =
  | {
      type: "text_delta";
      delta?: string;
    }
  | {
      type: "error";
      error?: unknown;
    }
  | {
      type: "final";
      response?: unknown;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

const starterPrompts = [
  "Write a concise latency test prompt for this chat completion endpoint.",
  "Explain why an API key might receive a 401 response.",
  "Summarize the request path for a streamed chat completion.",
];

export function PlaygroundPage() {
  const user = useQuery(meQueryOptions).data;
  const apiKeysQuery = useApiKeysQuery();
  const modelsQuery = useModelsQuery({ viewer: user });
  const [selectedApiKeyId, setSelectedApiKeyId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [threadKey, setThreadKey] = useState(0);

  const apiKeys = apiKeysQuery.data?.keys ?? [];
  const selectableApiKeys = useMemo(
    () => apiKeys.filter((key) => key.isActive && key.createdBy === user?.id),
    [apiKeys, user?.id],
  );
  const selectedApiKey =
    selectableApiKeys.find((key) => key.id === selectedApiKeyId) ?? selectableApiKeys[0] ?? null;
  const models = modelsQuery.data?.data ?? [];
  const allowedModels = useMemo(
    () => models.filter((model) => isModelAllowedByKey(selectedApiKey, model.id)),
    [models, selectedApiKey],
  );
  const selectedModel =
    allowedModels.find((model) => model.id === selectedModelId) ?? allowedModels[0] ?? null;

  useEffect(() => {
    if (!selectedApiKeyId && selectableApiKeys[0]) {
      setSelectedApiKeyId(selectableApiKeys[0].id);
    }
  }, [selectableApiKeys, selectedApiKeyId]);

  useEffect(() => {
    if (selectedModelId && allowedModels.some((model) => model.id === selectedModelId)) {
      return;
    }

    setSelectedModelId(allowedModels[0]?.id ?? "");
  }, [allowedModels, selectedModelId]);

  const resetThread = () => setThreadKey((value) => value + 1);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {apiKeysQuery.isLoading || modelsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : selectableApiKeys.length === 0 ? (
        <Alert>
          <AlertTitle>No active API keys</AlertTitle>
          <AlertDescription>Create an API key before running playground prompts.</AlertDescription>
        </Alert>
      ) : models.length === 0 ? (
        <Alert>
          <AlertTitle>No models available</AlertTitle>
          <AlertDescription>
            Configure a provider key before running playground prompts.
          </AlertDescription>
        </Alert>
      ) : selectedApiKey && selectedModel ? (
        <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border bg-card shadow-sm lg:grid-cols-[18rem_minmax(0,1fr)] lg:grid-rows-1">
          <PlaygroundSubSidebar
            allowedModels={allowedModels}
            onApiKeyChange={setSelectedApiKeyId}
            onModelChange={setSelectedModelId}
            onReset={resetThread}
            selectableApiKeys={selectableApiKeys}
            selectedApiKeyId={selectedApiKeyId}
            selectedModelId={selectedModelId}
          />
          <PlaygroundThread
            key={threadKey}
            apiKeyId={selectedApiKey.id}
            model={selectedModel.id}
            modelLabel={`${modelProviderLabel(selectedModel)} / ${selectedModel.name}`}
          />
        </div>
      ) : (
        <Alert>
          <AlertTitle>No allowed models</AlertTitle>
          <AlertDescription>
            Update the selected API key to allow at least one available model.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function PlaygroundSubSidebar({
  allowedModels,
  onApiKeyChange,
  onModelChange,
  onReset,
  selectableApiKeys,
  selectedApiKeyId,
  selectedModelId,
}: {
  allowedModels: Model[];
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onReset: () => void;
  selectableApiKeys: ApiKey[];
  selectedApiKeyId: string;
  selectedModelId: string;
}) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col gap-4 border-b bg-muted/20 p-3 lg:border-b-0 lg:border-r lg:p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-md border bg-background text-primary">
          <HugeiconsIcon icon={PlayIcon} className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Playground</p>
          <p className="truncate text-xs text-muted-foreground">Chat completions</p>
        </div>
      </div>

      <div className="grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="playground-api-key" className="text-xs font-medium text-muted-foreground">
            API key
          </Label>
          <Select value={selectedApiKeyId} onValueChange={onApiKeyChange}>
            <SelectTrigger id="playground-api-key" className="h-9 w-full min-w-0 bg-background">
              <SelectValue placeholder="Select API key" />
            </SelectTrigger>
            <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
              {selectableApiKeys.map((key) => (
                <SelectItem key={key.id} value={key.id}>
                  {key.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid min-w-0 gap-2">
          <Label htmlFor="playground-model" className="text-xs font-medium text-muted-foreground">
            Model
          </Label>
          <Select value={selectedModelId} onValueChange={onModelChange}>
            <SelectTrigger id="playground-model" className="h-9 w-full min-w-0 bg-background">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
              {allowedModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="button" variant="outline" className="w-full justify-start" onClick={onReset}>
        <HugeiconsIcon icon={Refresh01Icon} className="size-4" />
        New chat
      </Button>

      <div className="hidden gap-1 rounded-md border bg-background/70 p-3 text-xs text-muted-foreground lg:grid">
        <span className="font-medium text-foreground">Endpoint</span>
        <span className="truncate">/v1/chat/completions</span>
      </div>
    </aside>
  );
}

function PlaygroundThread({
  apiKeyId,
  model,
  modelLabel,
}: {
  apiKeyId: string;
  model: string;
  modelLabel: string;
}) {
  const adapter = useMemo(
    () => createPlaygroundChatModelAdapter({ apiKeyId, model }),
    [apiKeyId, model],
  );
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-card">
        <div className="flex min-h-[4.5rem] shrink-0 flex-col gap-3 border-b px-3 py-3 lg:flex-row lg:items-center lg:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-md border bg-background text-primary">
              <HugeiconsIcon icon={PlayIcon} className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium">{model}</p>
                <Badge variant="secondary" className="shrink-0">
                  chat
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{modelLabel}</p>
            </div>
          </div>
        </div>

        <ThreadPrimitive.Viewport
          autoScroll
          turnAnchor="bottom"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background/35"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 text-base">
            <ThreadPrimitive.Empty>
              <PlaygroundEmptyState />
            </ThreadPrimitive.Empty>

            <ThreadPrimitive.Messages>
              {({ message }) => {
                if (message.role === "user") {
                  return <UserMessage />;
                }

                if (message.role === "system") {
                  return <SystemMessage />;
                }

                return <AssistantMessage />;
              }}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 bg-gradient-to-t from-card via-card/95 to-card/0 px-4 pb-4 pt-8">
            <div className="mx-auto w-full max-w-3xl">
              <PlaygroundComposer />
            </div>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function PlaygroundEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-md border bg-card text-primary shadow-sm">
        <HugeiconsIcon icon={PlayIcon} className="size-6" />
      </div>
      <div className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-normal">Test a model</h2>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          Send prompts through your internal chat completion route and inspect the streamed answer.
        </p>
      </div>
      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-3">
        {starterPrompts.map((prompt) => (
          <StarterPromptButton key={prompt} prompt={prompt} />
        ))}
      </div>
    </div>
  );
}

function StarterPromptButton({ prompt }: { prompt: string }) {
  const thread = useThreadRuntime();

  return (
    <button
      type="button"
      onClick={() => thread.append(prompt)}
      className="min-h-24 rounded-lg border bg-card p-3 text-left text-sm leading-5 text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {prompt}
    </button>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[82%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-base leading-7 text-primary-foreground shadow-sm sm:max-w-[72%]">
        <MessagePrimitive.Parts
          components={{
            Text: () => (
              <span className="whitespace-pre-wrap break-words">
                <MessagePartPrimitive.Text />
              </span>
            ),
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="max-w-full">
      <div className="min-w-0">
        <div className="min-h-8 rounded-lg px-1 py-1">
          <MessagePrimitive.Parts
            components={{
              Text: AssistantMarkdownText,
              Reasoning: () => null,
              tools: {
                Fallback: ({ toolName }) => (
                  <div className="rounded-lg border bg-muted/40 p-3 text-base text-muted-foreground">
                    Tool call: {toolName}
                  </div>
                ),
              },
              Empty: () => (
                <div className="flex items-center gap-2 text-base text-muted-foreground">
                  <span className="size-2 animate-pulse rounded-full bg-primary" />
                  Thinking
                </div>
              ),
            }}
          />
        </div>
        <MessagePrimitive.Error>
          <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-base text-destructive">
            <ErrorPrimitive.Message />
          </div>
        </MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
  );
}

function SystemMessage() {
  return (
    <MessagePrimitive.Root className="mx-auto max-w-2xl rounded-lg border bg-muted/40 px-3 py-2 text-center text-base text-muted-foreground">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMarkdownText() {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md text-base leading-7 text-foreground [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-background [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5"
    />
  );
}

function PlaygroundComposer() {
  const isRunning = useThread((thread) => thread.isRunning);

  return (
    <ComposerPrimitive.Root className="rounded-lg border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/50">
      <ComposerPrimitive.Input
        aria-label="Prompt"
        placeholder="Message the model"
        submitMode="enter"
        rows={1}
        className="max-h-52 min-h-16 w-full resize-none bg-transparent px-4 py-3 text-base leading-7 outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-end px-2 pb-2">
        {isRunning ? (
          <ComposerPrimitive.Cancel asChild>
            <Button type="button" variant="outline" className="min-w-20">
              Stop
            </Button>
          </ComposerPrimitive.Cancel>
        ) : (
          <ComposerPrimitive.Send asChild>
            <Button type="submit" className="min-w-20">
              Send
            </Button>
          </ComposerPrimitive.Send>
        )}
      </div>
    </ComposerPrimitive.Root>
  );
}

export function createPlaygroundChatModelAdapter({
  apiKeyId,
  model,
}: {
  apiKeyId: string;
  model: string;
}): ChatModelAdapter {
  return {
    async *run(options: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
      const request: PlaygroundCompletionRequest = {
        apiKeyId,
        model,
        messages: threadMessagesToPlaygroundMessages(options.messages),
        stream: true,
      };
      const stream = fetchEventStream<PlaygroundStreamEvent>(
        `${apiBase}/playground/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          credentials: "include",
          signal: options.abortSignal,
          format: "jsonl",
        },
      );
      let text = "";
      let hasYielded = false;

      for await (const event of stream) {
        if (event.type === "text_delta" && typeof event.delta === "string") {
          text += event.delta;
          hasYielded = true;
          yield { content: [{ type: "text", text }] };
          continue;
        }

        if (event.type === "error") {
          throw new Error(formatError(event.error) ?? "Request failed");
        }
      }

      if (!hasYielded) {
        yield { content: [{ type: "text", text }] };
      }
    },
  };
}

export function threadMessagesToPlaygroundMessages(
  messages: readonly ThreadMessage[],
): AnviaCoreMessage[] {
  return uiMessagesToCoreMessages(threadMessagesToAnviaUIMessages(messages));
}

export function threadMessagesToAnviaUIMessages(messages: readonly ThreadMessage[]): UIMessage[] {
  const uiMessages: UIMessage[] = [];

  for (const message of messages) {
    const parts = threadMessageToAnviaParts(message);

    if (parts.length === 0) continue;

    uiMessages.push({
      id: message.id,
      role: message.role,
      parts,
    });
  }

  return uiMessages;
}

function threadMessageToAnviaParts(message: ThreadMessage): AnviaUIMessagePart[] {
  const parts: AnviaUIMessagePart[] = [];

  message.content.forEach((part, index) => {
    const id = `${message.id}-part-${index}`;

    if (part.type === "text") {
      const text = part.text.trim();
      if (text) {
        parts.push({ id, type: "text", text });
      }
      return;
    }

    if (part.type === "reasoning") {
      const text = part.text.trim();
      if (text) {
        parts.push({ id, type: "reasoning", text });
      }
    }
  });

  return parts;
}

function isModelAllowedByKey(key: ApiKey | null, modelId: string): boolean {
  if (!key) return true;
  return key.allowAllModels || key.allowedModelIds?.includes(modelId) === true;
}

function modelProviderLabel(model: Model) {
  return model.provider === "mux" ? "Mux" : model.provider;
}

function formatError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  if (typeof error === "string") return error;
  return "Unknown error";
}
