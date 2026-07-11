import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const { mockUseLogsQuery, mockUseLogsStatsQuery } = vi.hoisted(() => ({
  mockUseLogsQuery: vi.fn(),
  mockUseLogsStatsQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { role: "ADMIN" } }),
}));
vi.mock("../../../src/modules/auth/hooks/use-auth", () => ({
  meQueryOptions: {},
}));
vi.mock("../../../src/modules/api-keys/hooks", () => ({
  useApiKeysQuery: () => ({ data: { keys: [] } }),
}));
vi.mock("../../../src/modules/users/hooks", () => ({
  useUsersQuery: () => ({ data: { users: [] } }),
}));
vi.mock("../../../src/modules/logs/hooks", () => ({
  useLogsQuery: mockUseLogsQuery,
  useLogsStatsQuery: mockUseLogsStatsQuery,
}));
vi.mock("../../../src/modules/logs/request-trend-chart", () => ({
  RequestTrendChart: () => React.createElement("div", null, "Request trend"),
}));

import { LogsPage } from "../../../src/modules/logs/logs-page";

describe("LogsPage", () => {
  beforeEach(() => {
    mockUseLogsQuery.mockReset().mockReturnValue({
      data: {
        logs: [
          {
            id: "log-1",
            provider: "secret-provider",
            model: "gpt-4o",
            endpoint: "/v1/chat/completions",
            latencyMs: 123,
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            estimatedCost: 0.0123,
            pricingInputTokens: null,
            appliedInputPricePer1M: null,
            appliedOutputPricePer1M: null,
            appliedPricingTierThreshold: null,
            statusCode: 200,
            errorMessage: null,
            createdAt: "2026-07-11T00:00:00.000Z",
            apiKey: { name: "Primary key" },
          },
        ],
        total: 1,
      },
      isLoading: false,
    });
    mockUseLogsStatsQuery.mockReset().mockReturnValue({
      data: {
        totalRequests: 1,
        totalTokens: 30,
        totalPromptTokens: 10,
        totalCompletionTokens: 20,
        totalCost: 0.0123,
        byProvider: [
          {
            provider: "secret-provider",
            requests: 1,
            tokens: 30,
            promptTokens: 10,
            completionTokens: 20,
            cost: 0.0123,
          },
        ],
        byModel: [],
        daily: [],
      },
    });
  });

  it("hides provider information while preserving the request log", () => {
    render(React.createElement(LogsPage));

    expect(screen.queryByText(/provider/i)).toBeNull();
    expect(screen.queryByText("secret-provider")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Upstream latency" })).toBeDefined();
    expect(screen.getByText("gpt-4o")).toBeDefined();
    expect(screen.getByText("Primary key")).toBeDefined();
    expect(screen.getByText("123 ms")).toBeDefined();
    expect(screen.getAllByText("$0.0123")).toHaveLength(2);

    const logFilters = mockUseLogsQuery.mock.calls[0]?.[0];
    const statsFilters = mockUseLogsStatsQuery.mock.calls[0]?.[0];
    expect(logFilters).not.toHaveProperty("provider");
    expect(statsFilters).not.toHaveProperty("provider");
  });
});
