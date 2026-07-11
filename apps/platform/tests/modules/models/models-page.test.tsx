import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockUseModelsQuery, mockUseQuery } = vi.hoisted(() => ({
  mockUseModelsQuery: vi.fn(),
  mockUseQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: mockUseQuery }));
vi.mock("../../../src/modules/auth/hooks/use-auth", () => ({ meQueryOptions: {} }));
vi.mock("../../../src/modules/models/hooks", () => ({ useModelsQuery: mockUseModelsQuery }));
vi.mock("../../../src/modules/providers/hooks", () => ({
  PROVIDER_LABELS: {},
  providerLabel: (provider: string) => provider,
}));

import { ModelsPage } from "../../../src/modules/models/models-page";

describe("ModelsPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("describes the global catalog and provider setup for admins", () => {
    const admin = { id: "admin-1", role: "ADMIN" };
    mockUseQuery.mockReturnValue({ data: admin, isLoading: false });
    mockUseModelsQuery.mockReturnValue({ data: { data: [] }, isLoading: false });

    render(<ModelsPage />);

    expect(mockUseModelsQuery).toHaveBeenCalledWith({ viewer: admin });
    expect(
      screen.getByText("Aggregated across every provider that has an API key configured."),
    ).toBeTruthy();
    expect(screen.getByText("No providers configured")).toBeTruthy();
  });

  it("describes account-scoped access and its empty state for regular users", () => {
    const user = { id: "user-1", role: "USER" };
    mockUseQuery.mockReturnValue({ data: user, isLoading: false });
    mockUseModelsQuery.mockReturnValue({ data: { data: [] }, isLoading: false });

    render(<ModelsPage />);

    expect(mockUseModelsQuery).toHaveBeenCalledWith({ viewer: user });
    expect(
      screen.getByText(
        "Models available to your account. If you have no active API key, the global catalog is shown.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("No models available")).toBeTruthy();
    expect(
      screen.getByText("Your account does not currently have any available models."),
    ).toBeTruthy();
  });

  it("renders available aliases without an Alias badge", () => {
    const user = { id: "user-1", role: "USER" };
    mockUseQuery.mockReturnValue({ data: user, isLoading: false });
    mockUseModelsQuery.mockReturnValue({
      data: {
        data: [
          {
            id: "fast-chat",
            name: "Fast chat",
            provider: "mux",
            type: "alias",
            inputPricePer1M: 1,
            outputPricePer1M: 2,
            contextWindow: 128_000,
            maxOutputTokens: 4096,
            inputModalities: ["text"],
            outputModalities: ["text"],
            reasoning: false,
            toolCall: true,
            structuredOutput: true,
            weights: "closed",
            aliasTargetModelId: "openai:gpt-4o",
          },
        ],
      },
      isLoading: false,
    });

    render(<ModelsPage />);

    expect(screen.getByText("fast-chat")).toBeTruthy();
    expect(screen.queryByText("Alias")).toBeNull();
  });
});
