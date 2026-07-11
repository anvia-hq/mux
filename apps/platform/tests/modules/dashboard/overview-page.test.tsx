import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockStatsQuery, mockUseLogsStatsQuery } = vi.hoisted(() => ({
  mockStatsQuery: { data: undefined as unknown },
  mockUseLogsStatsQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { name: "Ada", email: "ada@example.com" } }),
}));
vi.mock("../../../src/modules/auth/hooks/use-auth", () => ({
  meQueryOptions: {},
}));
vi.mock("../../../src/modules/logs/hooks", () => ({
  useLogsStatsQuery: mockUseLogsStatsQuery,
}));
vi.mock("../../../src/modules/logs/request-trend-chart", () => ({
  RequestTrendChart: ({ onDaysChange }: { onDaysChange: (days: 7) => void }) =>
    React.createElement("button", { type: "button", onClick: () => onDaysChange(7) }, "Use 7 days"),
}));

import { OverviewPage } from "../../../src/modules/dashboard/components/overview-page";

describe("OverviewPage", () => {
  beforeEach(() => {
    mockUseLogsStatsQuery.mockReset().mockImplementation(() => mockStatsQuery);
    mockStatsQuery.data = {
      totalRequests: 12,
      totalTokens: 1_200,
      totalPromptTokens: 900,
      totalCompletionTokens: 300,
      totalCost: 1.2,
      byProvider: [
        {
          provider: "secret-provider",
          requests: 12,
          tokens: 1_200,
          promptTokens: 900,
          completionTokens: 300,
          cost: 1.2,
        },
      ],
      byModel: [
        {
          model: "openai:gpt-4o",
          requests: 12,
          tokens: 1_200,
          promptTokens: 900,
          completionTokens: 300,
          cost: 1.2,
        },
      ],
      daily: [
        {
          date: "2026-07-10",
          requests: 4,
          tokens: 400,
          promptTokens: 300,
          completionTokens: 100,
          cost: 0.4,
        },
        {
          date: "2026-07-11",
          requests: 8,
          tokens: 800,
          promptTokens: 600,
          completionTokens: 200,
          cost: 0.8,
        },
      ],
    };
  });

  it("shows provider-free activity and efficiency insights for the selected range", () => {
    render(React.createElement(OverviewPage));

    expect(screen.getByText("Activity")).toBeDefined();
    expect(screen.getByText("Efficiency")).toBeDefined();
    expect(screen.getByText("2 of 30")).toBeDefined();
    expect(screen.getByText("Jul 11 · 8 requests")).toBeDefined();
    expect(screen.getByText("6 requests")).toBeDefined();
    expect(screen.getByText("100")).toBeDefined();
    expect(screen.getByText("75%")).toBeDefined();
    expect(screen.getByText("$0.1000")).toBeDefined();
    expect(screen.queryByText("secret-provider")).toBeNull();
    expect(screen.queryByText("openai:gpt-4o")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use 7 days" }));

    expect(mockUseLogsStatsQuery).toHaveBeenLastCalledWith({ days: 7 });
    expect(screen.getByText("2 of 7")).toBeDefined();
    expect(screen.getAllByText(/last 7 days/i)).toHaveLength(2);
  });

  it("shows safe empty states when the selected range has no traffic", () => {
    mockStatsQuery.data = {
      totalRequests: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      byProvider: [],
      byModel: [],
      daily: [],
    };

    render(React.createElement(OverviewPage));

    expect(screen.getByText("No request activity in this range.")).toBeDefined();
    expect(
      screen.getByText("Efficiency metrics will appear after the first request."),
    ).toBeDefined();
    expect(screen.queryByText("NaN")).toBeNull();
    expect(screen.queryByText("Infinity")).toBeNull();
  });

  it("shows placeholders while overview stats are loading", () => {
    mockStatsQuery.data = undefined;

    render(React.createElement(OverviewPage));

    expect(screen.getAllByText("—")).toHaveLength(6);
    expect(screen.queryByText("NaN")).toBeNull();
    expect(screen.queryByText("Infinity")).toBeNull();
  });
});
