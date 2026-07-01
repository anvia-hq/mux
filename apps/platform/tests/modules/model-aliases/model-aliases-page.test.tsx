import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

const { mockAliasesQuery, mockCreateAlias, mockDeleteAlias, mockModelsQuery, mockUpdateAlias } =
  vi.hoisted(() => ({
    mockAliasesQuery: { data: { data: [] as unknown[] }, isLoading: false },
    mockCreateAlias: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
    mockDeleteAlias: { mutate: vi.fn(), isPending: false, error: null as Error | null },
    mockModelsQuery: { data: { data: [] as unknown[] }, isLoading: false },
    mockUpdateAlias: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
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
  useModelsQuery: () => mockModelsQuery,
}));
vi.mock("../../../src/modules/model-aliases/hooks", () => ({
  useCreateModelAliasMutation: () => mockCreateAlias,
  useDeleteModelAliasMutation: () => mockDeleteAlias,
  useModelAliasesQuery: () => mockAliasesQuery,
  useUpdateModelAliasMutation: () => mockUpdateAlias,
}));

import { ModelAliasesPage } from "../../../src/modules/model-aliases/model-aliases-page";

const models = [
  {
    id: "openai:gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    inputPricePer1M: 1,
    outputPricePer1M: 2,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "mux:fast",
    name: "Fast fallback",
    provider: "mux",
    type: "fallback-group",
    inputPricePer1M: 1,
    outputPricePer1M: 2,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "existing-alias",
    name: "Existing alias",
    provider: "mux",
    type: "alias",
    aliasTargetModelId: "openai:gpt-4o",
    inputPricePer1M: 1,
    outputPricePer1M: 2,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
] as const;

const aliases = [
  {
    id: "fast-chat",
    name: "Fast chat",
    description: "Primary route",
    targetModelId: "openai:gpt-4o",
    targetAvailable: true,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function renderPage() {
  render(React.createElement(ModelAliasesPage));
}

function openCreateDialog() {
  fireEvent.click(screen.getAllByRole("button", { name: /create alias/i })[0]);
  return screen.getByRole("dialog");
}

function submitDialogForm(dialog: HTMLElement, buttonName: string) {
  const button = within(dialog).getByRole("button", { name: buttonName });
  const form = button.closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

describe("ModelAliasesPage", () => {
  beforeEach(() => {
    mockCreateAlias.mutateAsync.mockReset().mockResolvedValue({ alias: aliases[0] });
    mockUpdateAlias.mutateAsync.mockReset().mockResolvedValue({ alias: aliases[0] });
    mockDeleteAlias.mutate.mockReset();
    mockCreateAlias.isPending = false;
    mockCreateAlias.error = null;
    mockUpdateAlias.isPending = false;
    mockUpdateAlias.error = null;
    mockDeleteAlias.isPending = false;
    mockDeleteAlias.error = null;
    mockAliasesQuery.data = { data: [] };
    mockAliasesQuery.isLoading = false;
    mockModelsQuery.data = { data: [...models] };
    mockModelsQuery.isLoading = false;
  });

  it("renders empty and populated states", () => {
    const { rerender } = render(React.createElement(ModelAliasesPage));
    expect(screen.getByText("No model aliases")).toBeDefined();

    mockAliasesQuery.data = { data: aliases };
    rerender(React.createElement(ModelAliasesPage));

    expect(screen.getByText("fast-chat")).toBeDefined();
    expect(screen.getByText("openai:gpt-4o")).toBeDefined();
    expect(screen.getByText("On")).toBeDefined();
  });

  it("creates aliases using only non-alias model targets", async () => {
    renderPage();
    const dialog = openCreateDialog();

    expect(within(dialog).queryByRole("option", { name: /existing-alias/i })).toBeNull();

    fireEvent.change(within(dialog).getByLabelText("Alias ID"), {
      target: { value: "quick" },
    });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Quick" },
    });
    fireEvent.change(within(dialog).getByLabelText("Target model"), {
      target: { value: "mux:fast" },
    });

    submitDialogForm(dialog, "Create alias");

    expect(mockCreateAlias.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "quick",
        name: "Quick",
        targetModelId: "mux:fast",
      }),
    );
  });

  it("edits an existing alias", () => {
    mockAliasesQuery.data = { data: aliases };
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /edit fast chat/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Fast chat v2" },
    });

    submitDialogForm(dialog, "Save changes");

    expect(mockUpdateAlias.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fast-chat",
        name: "Fast chat v2",
      }),
    );
  });
});
