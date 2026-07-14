import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const {
  mockFetchEventStream,
  mockThreadAppend,
  mockUseApiKeysQuery,
  mockUseLocalRuntime,
  mockUseModelsQuery,
  mockUseQuery,
  mockUseThread,
} = vi.hoisted(() => ({
  mockFetchEventStream: vi.fn(),
  mockThreadAppend: vi.fn(),
  mockUseApiKeysQuery: vi.fn(),
  mockUseLocalRuntime: vi.fn((adapter) => ({ adapter })),
  mockUseModelsQuery: vi.fn(),
  mockUseQuery: vi.fn(() => ({ data: { id: "admin-1", role: "ADMIN" } })),
  mockUseThread: vi.fn((selector?: (state: { isRunning: boolean }) => unknown) => {
    const state = { isRunning: false };
    return selector ? selector(state) : state;
  }),
}));

function renderAsChild(element: keyof React.JSX.IntrinsicElements, props: Record<string, unknown>) {
  const { asChild, autoScroll: _autoScroll, children, submitMode: _submitMode, turnAnchor: _turnAnchor, ...rest } =
    props;

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, rest);
  }

  return React.createElement(element, rest, children as React.ReactNode);
}

vi.mock("@anvia/react", () => ({
  fetchEventStream: mockFetchEventStream,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: mockUseQuery,
}));
vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "assistant-runtime" }, children),
  ComposerPrimitive: {
    Root: (props: Record<string, unknown>) => renderAsChild("form", props),
    Input: (props: Record<string, unknown>) => renderAsChild("textarea", props),
    Cancel: (props: Record<string, unknown>) => renderAsChild("button", props),
    Send: (props: Record<string, unknown>) => renderAsChild("button", props),
  },
  ErrorPrimitive: {
    Message: () => React.createElement("span", null, "Request failed"),
  },
  MessagePartPrimitive: {
    Text: () => React.createElement("span", null),
  },
  MessagePrimitive: {
    Root: (props: Record<string, unknown>) => renderAsChild("div", props),
    Parts: () => React.createElement("div", null),
    Error: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
  },
  ThreadPrimitive: {
    Root: (props: Record<string, unknown>) => renderAsChild("section", props),
    Viewport: (props: Record<string, unknown>) => renderAsChild("div", props),
    ViewportFooter: (props: Record<string, unknown>) => renderAsChild("div", props),
    Empty: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
    Messages: () => null,
  },
  useLocalRuntime: mockUseLocalRuntime,
  useThread: mockUseThread,
  useThreadRuntime: () => ({ append: mockThreadAppend }),
}));
vi.mock("@assistant-ui/react-markdown", () => ({
  MarkdownTextPrimitive: () => React.createElement("span", null),
}));
vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => React.createElement("span", { "data-testid": "icon" }),
}));
vi.mock("../../../src/lib/api-client", () => ({ apiBase: "http://api.test" }));
vi.mock("../../../src/modules/api-keys/hooks", () => ({
  useApiKeysQuery: mockUseApiKeysQuery,
}));
vi.mock("../../../src/modules/models/hooks", () => ({
  useModelsQuery: mockUseModelsQuery,
}));

import {
  PlaygroundPage,
  createPlaygroundChatModelAdapter,
  threadMessagesToPlaygroundMessages,
} from "../../../src/modules/playground/playground-page";

describe("PlaygroundPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockUseThread.mockImplementation((selector?: (state: { isRunning: boolean }) => unknown) => {
      const state = { isRunning: false };
      return selector ? selector(state) : state;
    });
  });

  it("streams chat completions through the playground endpoint", async () => {
    mockFetchEventStream.mockReturnValue(
      (async function* () {
        yield { type: "text_delta", delta: "hel" };
        yield { type: "text_delta", delta: "lo" };
        yield { type: "final", response: {} };
      })(),
    );
    const adapter = createPlaygroundChatModelAdapter({ apiKeyId: "key-1", model: "e2e:e2e-chat" });
    const abortController = new AbortController();
    const messages = [
      {
        id: "message-1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        role: "user",
        content: [{ type: "text", text: "hello provider" }],
        attachments: [],
        metadata: { custom: {} },
      },
    ];
    const updates = [];

    const run = adapter.run({
      messages,
      abortSignal: abortController.signal,
      context: {},
      runConfig: {},
      unstable_getMessage: () => messages[0],
    } as never) as AsyncGenerator<unknown, void, unknown>;

    for await (const update of run) {
      updates.push(update);
    }

    expect(mockFetchEventStream).toHaveBeenCalledWith(
      "http://api.test/playground/chat/completions",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        format: "jsonl",
        signal: abortController.signal,
      }),
    );
    const init = mockFetchEventStream.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({
      apiKeyId: "key-1",
      model: "e2e:e2e-chat",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello provider" }],
        },
      ],
      stream: true,
    });
    expect(updates).toEqual([
      { content: [{ type: "text", text: "hel" }] },
      { content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("maps thread messages to chat completion messages", () => {
    expect(
      threadMessagesToPlaygroundMessages([
        {
          id: "system-1",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          role: "system",
          content: [{ type: "text", text: "system prompt" }],
          metadata: { custom: {} },
        },
        {
          id: "assistant-1",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          role: "assistant",
          content: [{ type: "text", text: "assistant text" }],
          status: { type: "complete", reason: "stop" },
          metadata: {
            unstable_state: null,
            unstable_annotations: [],
            unstable_data: [],
            steps: [],
            custom: {},
          },
        },
      ] as never),
    ).toEqual([
      { role: "system", content: "system prompt" },
      { id: "assistant-1", role: "assistant", content: [{ type: "text", text: "assistant text" }] },
    ]);
  });

  it("keeps follow-up history in Anvia core message shape", () => {
    expect(
      threadMessagesToPlaygroundMessages([
        {
          id: "user-1",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          role: "user",
          content: [{ type: "text", text: "first prompt" }],
          attachments: [],
          metadata: { custom: {} },
        },
        {
          id: "assistant-1",
          createdAt: new Date("2026-01-01T00:00:01Z"),
          role: "assistant",
          content: [{ type: "text", text: "first answer" }],
          status: { type: "complete", reason: "stop" },
          metadata: {
            unstable_state: null,
            unstable_annotations: [],
            unstable_data: [],
            steps: [],
            custom: {},
          },
        },
        {
          id: "user-2",
          createdAt: new Date("2026-01-01T00:00:02Z"),
          role: "user",
          content: [{ type: "text", text: "follow up" }],
          attachments: [],
          metadata: { custom: {} },
        },
      ] as never),
    ).toEqual([
      { role: "user", content: [{ type: "text", text: "first prompt" }] },
      { id: "assistant-1", role: "assistant", content: [{ type: "text", text: "first answer" }] },
      { role: "user", content: [{ type: "text", text: "follow up" }] },
    ]);
  });

  it("renders assistant chat controls with the selected active key and first allowed model", async () => {
    mockUseApiKeysQuery.mockReturnValue({
      isLoading: false,
      data: {
        keys: [
          {
            id: "limited-key",
            name: "limited",
            createdBy: "admin-1",
            isActive: true,
            spendLimitUsd: 1,
            allowAllModels: false,
            includeFutureModels: false,
            allowedModelIds: ["e2e:e2e-chat"],
            canReveal: true,
          },
          {
            id: "key-1",
            name: "other-user-key",
            createdBy: "user-2",
            isActive: true,
            spendLimitUsd: null,
            allowAllModels: false,
            includeFutureModels: false,
            allowedModelIds: ["e2e:e2e-chat"],
            canReveal: true,
          },
        ],
      },
    });
    mockUseModelsQuery.mockReturnValue({
      isLoading: false,
      data: {
        data: [
          {
            id: "other:model",
            name: "Blocked",
            provider: "other",
          },
          {
            id: "e2e:e2e-chat",
            name: "E2E Chat",
            provider: "e2e",
          },
        ],
      },
    });

    render(React.createElement(PlaygroundPage));

    expect(screen.getByText(/\/v1\/chat\/completions/)).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Prompt" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "API key" }).textContent).toContain("limited");
      expect(screen.getByRole("combobox", { name: "Model" }).textContent).toContain("e2e:e2e-chat");
      expect(mockUseLocalRuntime).toHaveBeenCalled();
    });
  });

  it("swaps the composer action to stop while streaming", () => {
    mockUseThread.mockImplementation((selector?: (state: { isRunning: boolean }) => unknown) => {
      const state = { isRunning: true };
      return selector ? selector(state) : state;
    });
    mockUseApiKeysQuery.mockReturnValue({
      isLoading: false,
      data: {
        keys: [
          {
            id: "key-1",
            name: "admin-key",
            createdBy: "admin-1",
            isActive: true,
            spendLimitUsd: null,
            allowAllModels: true,
            includeFutureModels: true,
            allowedModelIds: null,
            canReveal: true,
          },
        ],
      },
    });
    mockUseModelsQuery.mockReturnValue({
      isLoading: false,
      data: {
        data: [{ id: "e2e:e2e-chat", name: "E2E Chat", provider: "e2e" }],
      },
    });

    render(React.createElement(PlaygroundPage));

    expect(screen.getByRole("button", { name: "Stop" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("appends starter prompts through the thread runtime", () => {
    mockUseApiKeysQuery.mockReturnValue({
      isLoading: false,
      data: {
        keys: [
          {
            id: "key-1",
            name: "admin-key",
            createdBy: "admin-1",
            isActive: true,
            spendLimitUsd: null,
            allowAllModels: true,
            includeFutureModels: true,
            allowedModelIds: null,
            canReveal: true,
          },
        ],
      },
    });
    mockUseModelsQuery.mockReturnValue({
      isLoading: false,
      data: {
        data: [{ id: "e2e:e2e-chat", name: "E2E Chat", provider: "e2e" }],
      },
    });

    render(React.createElement(PlaygroundPage));
    fireEvent.click(screen.getByRole("button", { name: /401 response/i }));

    expect(mockThreadAppend).toHaveBeenCalledWith(
      "Explain why an API key might receive a 401 response.",
    );
  });

  it("does not offer active API keys owned by another user", () => {
    mockUseApiKeysQuery.mockReturnValue({
      isLoading: false,
      data: {
        keys: [
          {
            id: "other-key",
            name: "other-user-key",
            createdBy: "user-2",
            isActive: true,
            spendLimitUsd: null,
            allowAllModels: true,
            includeFutureModels: true,
            allowedModelIds: null,
            canReveal: true,
          },
        ],
      },
    });
    mockUseModelsQuery.mockReturnValue({
      isLoading: false,
      data: { data: [{ id: "e2e:e2e-chat", name: "E2E Chat", provider: "e2e" }] },
    });

    render(React.createElement(PlaygroundPage));

    expect(screen.getByText("No active API keys")).not.toBeNull();
    expect(screen.queryByRole("combobox", { name: "API key" })).toBeNull();
  });

  it("shows a setup message without an active API key", () => {
    mockUseApiKeysQuery.mockReturnValue({
      isLoading: false,
      data: {
        keys: [
          {
            id: "limited-key",
            name: "limited",
            createdBy: "admin-1",
            isActive: false,
            spendLimitUsd: 1,
            allowAllModels: true,
            includeFutureModels: true,
            allowedModelIds: null,
            canReveal: true,
          },
        ],
      },
    });
    mockUseModelsQuery.mockReturnValue({ isLoading: false, data: { data: [] } });

    render(React.createElement(PlaygroundPage));

    expect(screen.getByText("No active API keys")).not.toBeNull();
  });
});
