import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@repo/ui/components/chart";
import { ToggleGroup, ToggleGroupItem } from "@repo/ui/components/toggle-group";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { LogsStats, StatsRangeDays } from "./hooks";

const chartConfig = {
  requests: {
    label: "Requests",
  },
} satisfies ChartConfig;

const ranges: StatsRangeDays[] = [7, 30, 90];

type RequestTrendChartProps = {
  stats: LogsStats | undefined;
  days: StatsRangeDays;
  onDaysChange: (days: StatsRangeDays) => void;
  title?: string;
  description?: string;
};

export function RequestTrendChart({
  stats,
  days,
  onDaysChange,
  title = "Request trend",
  description = "Daily gateway traffic",
}: RequestTrendChartProps) {
  const daily = stats?.daily ?? [];
  const hasTraffic = daily.some((row) => row.requests > 0);
  const averageRequests = stats ? Math.round(stats.totalRequests / days) : undefined;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="flex flex-col gap-4 border-b p-0 md:flex-row md:items-start md:justify-between">
        <div className="grid flex-1 divide-y md:grid-cols-4 md:divide-x md:divide-y-0">
          <Metric label={title} value={formatInteger(stats?.totalRequests)} active />
          <Metric label="Tokens" value={formatInteger(stats?.totalTokens)} />
          <Metric label="Cost" value={formatCurrency(stats?.totalCost)} />
          <Metric label="Avg / day" value={formatInteger(averageRequests)} />
        </div>
        <div className="flex items-center justify-between gap-3 px-4 pb-4 md:justify-end md:p-4">
          <p className="text-xs text-muted-foreground">{description}</p>
          <ToggleGroup
            type="single"
            value={String(days)}
            onValueChange={(value) => {
              if (value) onDaysChange(Number(value) as StatsRangeDays);
            }}
            variant="outline"
            size="sm"
            aria-label="Chart range"
          >
            {ranges.map((range) => (
              <ToggleGroupItem key={range} value={String(range)} aria-label={`${range} days`}>
                {range}d
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="relative px-2 pt-6 pb-4 sm:px-4">
        {!hasTraffic ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 text-center text-sm text-muted-foreground">
            No requests in this range.
          </div>
        ) : null}
        <ChartContainer
          config={chartConfig}
          className="h-[280px] w-full aspect-auto"
          initialDimension={{ width: 640, height: 280 }}
        >
          <AreaChart data={daily} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="requestTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="10%" stopColor="var(--foreground)" stopOpacity={0.22} />
                <stop offset="90%" stopColor="var(--foreground)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              tickMargin={12}
              tickFormatter={formatShortDate}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={formatCompact}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(value) => formatLongDate(String(value))}
                />
              }
            />
            <Area
              dataKey="requests"
              name="Requests"
              type="linear"
              stroke="var(--foreground)"
              strokeWidth={2}
              fill="url(#requestTrendFill)"
              fillOpacity={1}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: "var(--foreground)" }}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  active = false,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="grid gap-2 px-4 py-4">
      <CardTitle
        className={
          active
            ? "w-fit border-b border-foreground pb-1 text-xs font-semibold uppercase tracking-normal"
            : "text-xs font-medium uppercase tracking-normal text-muted-foreground"
        }
      >
        {label}
      </CardTitle>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function formatInteger(value: number | undefined) {
  return value === undefined ? "—" : value.toLocaleString();
}

function formatCurrency(value: number | undefined) {
  return value === undefined ? "—" : `$${value.toFixed(4)}`;
}

function formatCompact(value: number) {
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatShortDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatLongDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
