import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@repo/ui/components/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) =>
    React.createElement("section", null, children),
  CardContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  CardHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("header", null, children),
  CardTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h3", null, children),
}));
vi.mock("@repo/ui/components/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "chart-container" }, children),
  ChartTooltip: () => React.createElement("div", { "data-testid": "chart-tooltip" }),
  ChartTooltipContent: () => React.createElement("div", { "data-testid": "chart-tooltip-content" }),
}));
vi.mock("@repo/ui/components/toggle-group", () => {
  const ToggleContext = React.createContext<(value: string) => void>(() => undefined);
  return {
    ToggleGroup: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange: (value: string) => void;
    }) => React.createElement(ToggleContext.Provider, { value: onValueChange }, children),
    ToggleGroupItem: ({
      children,
      value,
      ...props
    }: Record<string, unknown> & { children: React.ReactNode; value: string }) => {
      const onValueChange = React.useContext(ToggleContext);
      return React.createElement(
        "button",
        { type: "button", ...props, onClick: () => onValueChange(value) },
        children,
      );
    },
  };
});
vi.mock("recharts", () => ({
  Bar: () => React.createElement("rect", { "data-testid": "bar" }),
  BarChart: ({ children }: { children: React.ReactNode }) =>
    React.createElement("svg", { "data-testid": "bar-chart" }, children),
  CartesianGrid: () => React.createElement("g", { "data-testid": "grid" }),
  ReferenceLine: () => React.createElement("line", { "data-testid": "reference-line" }),
  XAxis: ({ tickFormatter }: { tickFormatter: (value: string) => string }) =>
    React.createElement("text", null, tickFormatter("2026-06-24")),
  YAxis: ({ tickFormatter }: { tickFormatter: (value: number) => string }) =>
    React.createElement("text", null, tickFormatter(1500)),
}));

import { RequestTrendChart } from "../../../src/modules/logs/request-trend-chart";
import type { LogsStats } from "../../../src/modules/logs/hooks";

const stats: LogsStats = {
  totalRequests: 1234,
  totalTokens: 98765,
  totalPromptTokens: 12345,
  totalCompletionTokens: 86420,
  totalCost: 12.3456,
  byProvider: [],
  byModel: [],
  daily: [
    {
      date: "2026-06-23",
      requests: 10,
      tokens: 1000,
      promptTokens: 400,
      completionTokens: 600,
      cost: 0.5,
    },
    {
      date: "2026-06-24",
      requests: 20,
      tokens: 2000,
      promptTokens: 800,
      completionTokens: 1200,
      cost: 1,
    },
  ],
};

describe("RequestTrendChart", () => {
  it("renders empty metrics and no-traffic message", () => {
    render(
      React.createElement(RequestTrendChart, { stats: undefined, days: 7, onDaysChange: vi.fn() }),
    );

    expect(screen.getByText("Request trend")).toBeDefined();
    expect(screen.getByText("Daily gateway traffic")).toBeDefined();
    expect(screen.getByText("No requests in this range.")).toBeDefined();
    expect(screen.getAllByText("—")).toHaveLength(7);
  });

  it("renders formatted stats and chart formatters", () => {
    render(
      React.createElement(RequestTrendChart, {
        stats,
        days: 7,
        onDaysChange: vi.fn(),
        title: "Gateway usage",
        description: "Recent traffic",
      }),
    );

    expect(screen.getByText("Gateway usage")).toBeDefined();
    expect(screen.getByText("Recent traffic")).toBeDefined();
    expect(screen.getByText("1,234")).toBeDefined();
    expect(screen.getByText("12.3K")).toBeDefined();
    expect(screen.getByText("86.4K")).toBeDefined();
    expect(screen.getByText("12,345")).toBeDefined();
    expect(screen.getByText("86,420")).toBeDefined();
    expect(screen.getAllByText("$12.3456")).toHaveLength(2);
    expect(screen.getByText("176 avg/day")).toBeDefined();
    expect(screen.getAllByTestId("chart-container")).toHaveLength(1);
    expect(screen.getAllByTestId("bar")).toHaveLength(4);
    expect(screen.getAllByText("Jun 24")).toHaveLength(1);
    expect(screen.getAllByText("1.5K")).toHaveLength(1);
  });

  it("emits range changes and ignores empty toggle values", () => {
    const onDaysChange = vi.fn();
    render(React.createElement(RequestTrendChart, { stats, days: 30, onDaysChange }));

    fireEvent.click(screen.getByRole("button", { name: "90 days" }));

    expect(onDaysChange).toHaveBeenCalledWith(90);
  });
});
