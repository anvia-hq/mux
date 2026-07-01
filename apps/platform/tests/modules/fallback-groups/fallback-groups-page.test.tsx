import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

const { mockCreateGroup, mockDeleteGroup, mockGroupsQuery, mockModelsQuery, mockUpdateGroup } =
  vi.hoisted(() => ({
    mockCreateGroup: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
    mockDeleteGroup: { mutate: vi.fn(), isPending: false, error: null as Error | null },
    mockGroupsQuery: { data: { data: [] as unknown[] }, isLoading: false },
    mockModelsQuery: { data: { data: [] as unknown[] }, isLoading: false },
    mockUpdateGroup: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  }));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => React.createElement("span", { "data-testid": "icon" }),
}));
vi.mock("@repo/ui/components/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
}));
vi.mock("@repo/ui/components/button", () => ({
  Button: ({
    children,
    asChild: _asChild,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("button", { type: "button", ...props }, children),
}));
vi.mock("@repo/ui/components/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) =>
    React.createElement("section", null, children),
}));
vi.mock("@repo/ui/components/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? React.createElement("div", null, children) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { role: "dialog" }, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement("p", null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) =>
    React.createElement("footer", null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("header", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h2", null, children),
}));
vi.mock("@repo/ui/components/input", () => ({
  Input: (props: Record<string, unknown>) => React.createElement("input", props),
}));
vi.mock("@repo/ui/components/native-select", () => ({
  NativeSelect: ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("select", props, children),
  NativeSelectOption: ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("option", props, children),
}));
vi.mock("@repo/ui/components/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: Record<string, unknown> & {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) =>
    React.createElement("input", {
      ...props,
      checked,
      type: "checkbox",
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        onCheckedChange?.(event.target.checked),
    }),
}));
vi.mock("@repo/ui/components/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) =>
    React.createElement("table", null, children),
  TableBody: ({ children }: { children: React.ReactNode }) =>
    React.createElement("tbody", null, children),
  TableCell: ({ children }: { children: React.ReactNode }) =>
    React.createElement("td", null, children),
  TableHead: ({ children }: { children: React.ReactNode }) =>
    React.createElement("th", null, children),
  TableHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("thead", null, children),
  TableRow: ({ children }: { children: React.ReactNode }) =>
    React.createElement("tr", null, children),
}));
vi.mock("@repo/ui/components/textarea", () => ({
  Textarea: (props: Record<string, unknown>) => React.createElement("textarea", props),
}));
vi.mock("../../../src/modules/models/hooks", () => ({
  useModelTargetsQuery: () => mockModelsQuery,
}));
vi.mock("../../../src/modules/fallback-groups/hooks", () => ({
  useCreateFallbackGroupMutation: () => mockCreateGroup,
  useDeleteFallbackGroupMutation: () => mockDeleteGroup,
  useFallbackGroupsQuery: () => mockGroupsQuery,
  useUpdateFallbackGroupMutation: () => mockUpdateGroup,
}));

import { FallbackGroupsPage } from "../../../src/modules/fallback-groups/fallback-groups-page";

const providerModels = [
  {
    id: "openai:gpt-4",
    name: "GPT-4",
    provider: "openai",
    inputPricePer1M: 1,
    outputPricePer1M: 2,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "anthropic:claude-3",
    name: "Claude 3",
    provider: "anthropic",
    inputPricePer1M: 1,
    outputPricePer1M: 2,
    contextWindow: 200000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "mux:existing",
    name: "Existing",
    provider: "mux",
    type: "fallback-group",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
] as const;

const fallbackGroups = [
  {
    id: "fast-chat",
    publicModelId: "mux:fast-chat",
    name: "Fast chat",
    description: "Primary route",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    targets: [
      { provider: "openai", modelId: "gpt-4", publicModelId: "openai:gpt-4", position: 1 },
      {
        provider: "anthropic",
        modelId: "claude-3",
        publicModelId: "anthropic:claude-3",
        position: 2,
      },
    ],
  },
];

function renderPage() {
  render(React.createElement(FallbackGroupsPage));
}

function openCreateDialog() {
  fireEvent.click(screen.getAllByRole("button", { name: /create group/i })[0]);
  return screen.getByRole("dialog");
}

function submitDialogForm(dialog: HTMLElement, buttonName: string) {
  const button = within(dialog).getByRole("button", { name: buttonName });
  const form = button.closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

describe("FallbackGroupsPage", () => {
  beforeEach(() => {
    mockCreateGroup.mutateAsync.mockReset().mockResolvedValue({ group: fallbackGroups[0] });
    mockUpdateGroup.mutateAsync.mockReset().mockResolvedValue({ group: fallbackGroups[0] });
    mockDeleteGroup.mutate.mockReset();
    mockCreateGroup.isPending = false;
    mockCreateGroup.error = null;
    mockUpdateGroup.isPending = false;
    mockUpdateGroup.error = null;
    mockDeleteGroup.isPending = false;
    mockDeleteGroup.error = null;
    mockGroupsQuery.data = { data: [] };
    mockGroupsQuery.isLoading = false;
    mockModelsQuery.data = { data: [...providerModels] };
    mockModelsQuery.isLoading = false;
  });

  it("renders loading, empty, and populated states", () => {
    mockGroupsQuery.isLoading = true;
    const { rerender } = render(React.createElement(FallbackGroupsPage));
    expect(screen.getByText("Configured groups")).toBeDefined();

    mockGroupsQuery.isLoading = false;
    rerender(React.createElement(FallbackGroupsPage));
    expect(screen.getByText("No fallback groups")).toBeDefined();

    mockGroupsQuery.data = { data: fallbackGroups };
    rerender(React.createElement(FallbackGroupsPage));
    expect(screen.getByText("mux:fast-chat")).toBeDefined();
    expect(screen.getByText((content) => content.includes("openai:gpt-4"))).toBeDefined();
    expect(screen.getByText("On")).toBeDefined();
  });

  it("validates required create fields", () => {
    renderPage();
    const dialog = openCreateDialog();

    submitDialogForm(dialog, "Create group");

    expect(screen.getByText("Group ID and name are required.")).toBeDefined();
    expect(mockCreateGroup.mutateAsync).not.toHaveBeenCalled();
  });

  it("validates target provider and model before creating", () => {
    renderPage();
    const dialog = openCreateDialog();

    fireEvent.change(within(dialog).getByLabelText("Group ID"), { target: { value: "fast-chat" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Fast chat" } });
    submitDialogForm(dialog, "Create group");

    expect(screen.getByText("Every fallback target needs a provider and model.")).toBeDefined();
  });

  it("creates a fallback group with selected target and enabled state", async () => {
    renderPage();
    const dialog = openCreateDialog();

    fireEvent.change(within(dialog).getByLabelText("Group ID"), { target: { value: "fast-chat" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Fast chat" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "Primary route" },
    });
    fireEvent.click(within(dialog).getByLabelText("Enabled"));
    fireEvent.change(within(dialog).getByLabelText("Provider"), { target: { value: "openai" } });
    fireEvent.change(within(dialog).getByLabelText("Model"), { target: { value: "gpt-4" } });
    submitDialogForm(dialog, "Create group");

    await waitFor(() =>
      expect(mockCreateGroup.mutateAsync).toHaveBeenCalledWith({
        id: "fast-chat",
        name: "Fast chat",
        description: "Primary route",
        enabled: false,
        targets: [{ provider: "openai", modelId: "gpt-4" }],
      }),
    );
  });

  it("adds, removes, and reorders targets while editing", async () => {
    mockGroupsQuery.data = { data: fallbackGroups };
    renderPage();

    fireEvent.click(screen.getByLabelText("Edit Fast chat"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getAllByLabelText("Provider")).toHaveLength(3);

    fireEvent.click(within(dialog).getAllByLabelText("Remove target")[2]);
    expect(within(dialog).getAllByLabelText("Provider")).toHaveLength(2);

    fireEvent.click(within(dialog).getAllByLabelText("Move target down")[0]);
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Fast chat updated" },
    });
    submitDialogForm(dialog, "Save changes");

    await waitFor(() =>
      expect(mockUpdateGroup.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "fast-chat",
          name: "Fast chat updated",
          targets: [
            { provider: "anthropic", modelId: "claude-3" },
            { provider: "openai", modelId: "gpt-4" },
          ],
        }),
      ),
    );
  });

  it("resets the only target when it is removed", () => {
    renderPage();
    const dialog = openCreateDialog();

    fireEvent.click(within(dialog).getByLabelText("Remove target"));

    expect(within(dialog).getAllByLabelText("Provider")).toHaveLength(1);
    expect((within(dialog).getByLabelText("Provider") as HTMLSelectElement).value).toBe("");
    expect((within(dialog).getByLabelText("Model") as HTMLSelectElement).disabled).toBe(true);
  });

  it("deletes groups and renders mutation errors", () => {
    mockGroupsQuery.data = { data: fallbackGroups };
    mockDeleteGroup.error = new Error("Delete failed");
    renderPage();

    fireEvent.click(screen.getByLabelText("Delete Fast chat"));

    expect(mockDeleteGroup.mutate).toHaveBeenCalledWith("fast-chat");
    expect(screen.getByText("Delete failed")).toBeDefined();
  });

  it("renders save errors and disables submit while saving or loading models", () => {
    mockCreateGroup.error = new Error("Save failed");
    mockCreateGroup.isPending = true;
    mockModelsQuery.isLoading = true;
    renderPage();

    const dialog = openCreateDialog();

    expect(screen.getByText("Save failed")).toBeDefined();
    expect(
      (within(dialog).getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
