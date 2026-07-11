import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApplyModelAccess, mockIdleMutation, mockQuery, mockToastSuccess, mockUser } =
  vi.hoisted(() => ({
    mockApplyModelAccess: {
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null as Error | null,
    },
    mockIdleMutation: {
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null as Error | null,
    },
    mockQuery: {
      data: { keys: [] as Array<Record<string, unknown>> },
      isLoading: false,
      error: null as Error | null,
    },
    mockToastSuccess: vi.fn(),
    mockUser: {
      value: { id: "admin-1", email: "admin@test.com", role: "ADMIN" },
    },
  }));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => React.createElement("span", { "data-testid": "icon" }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mockUser.value }),
}));
vi.mock("sonner", () => ({ toast: { success: mockToastSuccess } }));
vi.mock("@repo/ui/components/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
}));
vi.mock("@repo/ui/components/button", () => ({
  Button: ({
    children,
    asChild: _asChild,
    ...props
  }: React.ComponentProps<"button"> & { asChild?: boolean }) =>
    React.createElement("button", { ...props, type: props.type ?? "button" }, children),
}));
vi.mock("@repo/ui/components/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) =>
    React.createElement("section", null, children),
  CardDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement("p", null, children),
  CardHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("header", null, children),
  CardTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h2", null, children),
}));
vi.mock("@repo/ui/components/checkbox", () => ({
  Checkbox: (props: React.ComponentProps<"input">) =>
    React.createElement("input", { ...props, type: "checkbox" }),
}));
vi.mock("@repo/ui/components/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open === false ? null : React.createElement("div", null, children),
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
  DialogTrigger: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@repo/ui/components/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuRadioItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@repo/ui/components/input", () => ({
  Input: (props: React.ComponentProps<"input">) => React.createElement("input", props),
}));
vi.mock("@repo/ui/components/label", () => ({
  Label: ({ children, ...props }: React.ComponentProps<"label">) =>
    React.createElement("label", props, children),
}));
vi.mock("@repo/ui/components/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
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
vi.mock("../../../src/lib/use-copy-feedback", () => ({
  useCopyFeedback: () => ({ copiedId: null, copy: vi.fn() }),
}));
vi.mock("../../../src/modules/auth/hooks/use-auth", () => ({ meQueryOptions: {} }));
vi.mock("../../../src/modules/models/hooks", () => ({
  useModelsQuery: () => ({ data: { data: [] }, isLoading: false }),
}));
vi.mock("../../../src/modules/api-keys/hooks", () => ({
  isForbiddenError: () => false,
  useApiKeysQuery: () => mockQuery,
  useApplyApiKeyModelAccessMutation: () => mockApplyModelAccess,
  useCreateApiKeyMutation: () => mockIdleMutation,
  useRevealApiKeyMutation: () => mockIdleMutation,
  useRevokeApiKeyMutation: () => mockIdleMutation,
  useRotateApiKeyMutation: () => mockIdleMutation,
  useUpdateApiKeyModelAccessMutation: () => mockIdleMutation,
}));

import { ApiKeysPage } from "../../../src/modules/api-keys/api-keys-page";

const activeKey = (id: string) => ({
  id,
  name: `Key ${id}`,
  createdBy: "admin-1",
  isActive: true,
  spendLimitUsd: null,
  spentUsd: 0,
  remainingUsd: null,
  allowAllModels: false,
  includeFutureModels: false,
  allowedModelIds: ["openai:gpt-4o"],
  canReveal: true,
  createdAt: "2026-07-11T00:00:00.000Z",
  creator: { email: "admin@test.com" },
});

describe("ApiKeysPage bulk model access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.value = { id: "admin-1", email: "admin@test.com", role: "ADMIN" };
    mockQuery.data = { keys: [activeKey("k1"), activeKey("k2")] };
    mockQuery.isLoading = false;
    mockQuery.error = null;
    mockApplyModelAccess.isPending = false;
    mockApplyModelAccess.error = null;
  });

  it("applies the default snapshot policy to all active keys", async () => {
    mockApplyModelAccess.mutate.mockImplementationOnce(
      (_input, options: { onSuccess?: (data: { updatedCount: number }) => void }) => {
        options.onSuccess?.({ updatedCount: 2 });
      },
    );
    render(<ApiKeysPage />);

    fireEvent.click(screen.getByRole("button", { name: "Apply Models" }));
    const heading = screen.getByRole("heading", { name: "Apply Models" });
    const dialog = heading.closest('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(
      within(dialog as HTMLElement).getByText("Replace model access for 2 active API keys."),
    ).toBeTruthy();

    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "Apply Models" }));

    expect(mockApplyModelAccess.mutate).toHaveBeenCalledWith(
      { mode: "snapshot" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("Models applied to 2 active API keys");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Apply Models" })).toBeNull());
  });

  it("shows bulk errors without closing the dialog", () => {
    mockApplyModelAccess.error = new Error("Could not update API keys");
    render(<ApiKeysPage />);

    fireEvent.click(screen.getByRole("button", { name: "Apply Models" }));

    expect(screen.getByText("Could not update API keys")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Apply Models" })).toBeTruthy();
  });

  it("hides the bulk action from non-admin users", () => {
    mockUser.value = { id: "user-1", email: "user@test.com", role: "USER" };

    render(<ApiKeysPage />);

    expect(screen.queryByRole("button", { name: "Apply Models" })).toBeNull();
  });

  it("disables the bulk action when there are no active keys", () => {
    mockQuery.data = { keys: [{ ...activeKey("k1"), isActive: false }] };

    render(<ApiKeysPage />);

    expect(
      (screen.getByRole("button", { name: "Apply Models" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
