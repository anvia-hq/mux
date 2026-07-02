import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@repo/ui/components/chart";
import { ToggleGroup, ToggleGroupItem } from "@repo/ui/components/toggle-group";
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import type { LogsStats, StatsRangeDays } from "./hooks";

const chartConfig = {
  requests: {
    label: "Requests",
    color: "var(--chart-4)",
  },
  promptTokens: {
    label: "Input",
    color: "var(--chart-1)",
  },
  completionTokens: {
    label: "Output",
    color: "var(--chart-2)",
  },
  cost: {
    label: "Cost",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

const ranges: StatsRangeDays[] = [7, 30, 90];
const metricColors = {
  requests: "var(--chart-4)",
  promptTokens: "var(--chart-1)",
  completionTokens: "var(--chart-2)",
  cost: "var(--chart-3)",
} as const;
const stackScale = 100;

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
  const chartData = buildStackedChartData(daily);
  const hasTraffic = daily.some((row) => row.requests > 0);
  const averageRequests = stats ? Math.round(stats.totalRequests / days) : undefined;
  const averageActivity = chartData.length
    ? Math.round(chartData.reduce((sum, row) => sum + row.totalActivityScore, 0) / days)
    : undefined;
  const barCategoryGap = getBarCategoryGap(days);
  const maxBarSize = getMaxBarSize(days);

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="gap-5 border-b p-5 sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-medium tracking-normal text-muted-foreground">
              {description}
            </CardTitle>
            <div className="mt-3 grid max-w-4xl gap-x-10 gap-y-4 sm:grid-cols-[minmax(13rem,1.1fr)_minmax(9.5rem,0.8fr)_minmax(9.5rem,0.8fr)] lg:gap-x-14">
              <HeadlineMetric
                label="Cost"
                value={formatCurrency(stats?.totalCost)}
                color={metricColors.cost}
              />
              <HeadlineMetric
                label="Input"
                value={formatCompactOptional(stats?.totalPromptTokens)}
                color={metricColors.promptTokens}
              />
              <HeadlineMetric
                label="Output"
                value={formatCompactOptional(stats?.totalCompletionTokens)}
                color={metricColors.completionTokens}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{formatInteger(stats?.totalRequests)} requests</span>
              <span>{formatInteger(averageRequests)} avg/day</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 md:justify-end">
            <p className="text-xs text-muted-foreground">{title}</p>
            <ToggleGroup
              type="single"
              value={String(days)}
              onValueChange={(value) => {
                if (value) onDaysChange(Number(value) as StatsRangeDays);
              }}
              variant="outline"
              size="sm"
              aria-label="Chart range"
              className="rounded-md border bg-muted/30"
            >
              {ranges.map((range) => (
                <ToggleGroupItem
                  key={range}
                  value={String(range)}
                  aria-label={`${range} days`}
                  className="border-0 text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground"
                >
                  {range}d
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Metric
            label="Requests"
            value={formatInteger(stats?.totalRequests)}
            color={metricColors.requests}
          />
          <Metric
            label="Input"
            value={formatInteger(stats?.totalPromptTokens)}
            color={metricColors.promptTokens}
          />
          <Metric
            label="Output"
            value={formatInteger(stats?.totalCompletionTokens)}
            color={metricColors.completionTokens}
          />
          <Metric label="Cost" value={formatCurrency(stats?.totalCost)} color={metricColors.cost} />
        </div>
      </CardHeader>
      <CardContent className="relative px-4 pt-5 pb-6 sm:px-6">
        {!hasTraffic ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 text-center text-sm text-muted-foreground">
            No requests in this range.
          </div>
        ) : null}
        <ChartContainer
          config={chartConfig}
          className="h-[300px] w-full aspect-auto"
          initialDimension={{ width: 640, height: 300 }}
        >
          <BarChart
            data={chartData}
            margin={{ top: 16, right: 16, bottom: 0, left: 0 }}
            barCategoryGap={barCategoryGap}
          >
            <CartesianGrid strokeDasharray="3 5" vertical stroke="var(--border)" />
            {averageActivity ? (
              <ReferenceLine
                yAxisId="activity"
                y={averageActivity}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 7"
                strokeWidth={1}
              />
            ) : null}
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              tickMargin={12}
              tickFormatter={formatShortDate}
            />
            <YAxis
              yAxisId="activity"
              hide
              domain={[0, "dataMax + 12"]}
              tickFormatter={formatCompact}
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", fillOpacity: 0.35 }}
              content={<UsageTooltip />}
            />
            <Bar
              yAxisId="activity"
              dataKey="requestScore"
              name="Requests"
              stackId="usage"
              fill={metricColors.requests}
              radius={[0, 0, 3, 3]}
              maxBarSize={maxBarSize}
            />
            <Bar
              yAxisId="activity"
              dataKey="promptTokenScore"
              name="Input"
              stackId="usage"
              fill={metricColors.promptTokens}
              radius={0}
              maxBarSize={maxBarSize}
            />
            <Bar
              yAxisId="activity"
              dataKey="completionTokenScore"
              name="Output"
              stackId="usage"
              fill={metricColors.completionTokens}
              radius={0}
              maxBarSize={maxBarSize}
            />
            <Bar
              yAxisId="activity"
              dataKey="costScore"
              name="Cost"
              stackId="usage"
              fill={metricColors.cost}
              radius={[3, 3, 0, 0]}
              maxBarSize={maxBarSize}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

type UsageChartRow = LogsStats["daily"][number] & {
  requestScore: number;
  promptTokenScore: number;
  completionTokenScore: number;
  costScore: number;
  totalActivityScore: number;
};

function buildStackedChartData(daily: LogsStats["daily"]): UsageChartRow[] {
  const maxRequests = Math.max(0, ...daily.map((row) => row.requests));
  const maxPromptTokens = Math.max(0, ...daily.map((row) => row.promptTokens));
  const maxCompletionTokens = Math.max(0, ...daily.map((row) => row.completionTokens));
  const maxCost = Math.max(0, ...daily.map((row) => row.cost));

  return daily.map((row) => {
    const requestScore = normalizeStackValue(row.requests, maxRequests);
    const promptTokenScore = normalizeStackValue(row.promptTokens, maxPromptTokens);
    const completionTokenScore = normalizeStackValue(row.completionTokens, maxCompletionTokens);
    const costScore = normalizeStackValue(row.cost, maxCost);

    return {
      ...row,
      requestScore,
      promptTokenScore,
      completionTokenScore,
      costScore,
      totalActivityScore: requestScore + promptTokenScore + completionTokenScore + costScore,
    };
  });
}

function normalizeStackValue(value: number, maxValue: number) {
  if (maxValue <= 0) return 0;
  return (value / maxValue) * stackScale;
}

function getBarCategoryGap(days: StatsRangeDays) {
  if (days <= 7) return "14%";
  if (days <= 30) return "6%";
  return "2%";
}

function getMaxBarSize(days: StatsRangeDays) {
  if (days <= 7) return 56;
  if (days <= 30) return 30;
  return 12;
}

function HeadlineMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="size-2 rounded-[2px]" style={{ backgroundColor: color }} />
        {label}
      </div>
      <div className="truncate text-4xl font-semibold leading-none tracking-normal tabular-nums text-card-foreground sm:text-5xl">
        {value}
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="grid gap-1 rounded-md bg-muted/30 px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-[2px]" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium tracking-normal text-muted-foreground">{label}</span>
      </div>
      <div className="text-xl font-semibold tracking-normal tabular-nums text-card-foreground">
        {value}
      </div>
    </div>
  );
}

function formatInteger(value: number | undefined) {
  return value === undefined ? "—" : value.toLocaleString();
}

function formatCurrency(value: number | undefined) {
  return value === undefined ? "—" : `$${value.toFixed(4)}`;
}

function formatCompactOptional(value: number | undefined) {
  return value === undefined ? "—" : formatCompact(value);
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

type TooltipPayload = {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: {
    date?: string;
    requests?: number;
    promptTokens?: number;
    completionTokens?: number;
    cost?: number;
  };
};

function UsageTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload;
  return (
    <div className="min-w-44 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-2 font-medium text-popover-foreground">
        {formatLongDate(String(label))}
      </div>
      <TooltipLine
        color={metricColors.requests}
        label="Requests"
        value={formatInteger(row?.requests)}
      />
      <TooltipLine
        color={metricColors.promptTokens}
        label="Input"
        value={formatInteger(row?.promptTokens)}
      />
      <TooltipLine
        color={metricColors.completionTokens}
        label="Output"
        value={formatInteger(row?.completionTokens)}
      />
      <TooltipLine color={metricColors.cost} label="Cost" value={formatCurrency(row?.cost)} />
    </div>
  );
}

function TooltipLine({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-0.5">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className="size-2 rounded-[2px]" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="font-medium tabular-nums text-popover-foreground">{value}</span>
    </div>
  );
}

function formatLongDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
