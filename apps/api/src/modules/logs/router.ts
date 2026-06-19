import { Hono } from "hono";
import { getCurrentUser } from "../auth/services";
import type { User } from "../../utils/prisma";
import { getLogs, getStats, type LogFilters, type StatsFilters } from "./services";

/**
 * Hono environment for the logs router. `user` is set by the auth guard below
 * after a successful authentication check, so handlers can rely on it being
 * a valid authenticated user.
 */
type LogsRouterEnv = {
  Variables: {
    user: User;
  };
};

/**
 * Parse a numeric query string value into a positive integer. Returns
 * `undefined` when the value is absent, empty, or not a valid positive
 * integer so the service layer can apply its defaults.
 */
function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Parse an ISO-8601 date string into a Date, returning `undefined` for empty
 * or invalid input. Invalid inputs are silently dropped so a malformed query
 * does not 500 the request; downstream code can rely on either a valid Date
 * or undefined.
 */
function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

/**
 * Router exposing request log browsing and aggregate statistics.
 *
 * Mounted under `/logs` by the main app. Both endpoints require any
 * authenticated user (admin or regular). Future enhancements could narrow
 * visibility to specific API keys owned by the requesting user.
 *
 * Endpoints:
 * - `GET /`        - Paginated request log entries with optional filters
 * - `GET /stats`   - Aggregate counts, tokens, and cost broken down by provider/model
 */
export const logsRouter = new Hono<LogsRouterEnv>();

// Auth guard: any authenticated user (admin or regular) can view logs.
logsRouter.use("*", async (c, next) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("user", user);
  await next();
});

/**
 * GET /
 *
 * Lists request log entries newest-first with optional filters for API key,
 * provider, model, and date range. Supports pagination via `limit` and
 * `offset` query parameters.
 *
 * Returns `{ logs, total, limit, offset }` so the client can render
 * pagination controls without an additional count call.
 */
logsRouter.get("/", async (c) => {
  const { apiKeyId, provider, model, startDate, endDate, limit, offset } = c.req.query();

  const filters: LogFilters = {};
  if (apiKeyId) filters.apiKeyId = apiKeyId;
  if (provider) filters.provider = provider;
  if (model) filters.model = model;

  const parsedStart = parseDate(startDate);
  if (parsedStart) filters.startDate = parsedStart;

  const parsedEnd = parseDate(endDate);
  if (parsedEnd) filters.endDate = parsedEnd;

  const parsedLimit = parsePositiveInt(limit);
  if (parsedLimit !== undefined) filters.limit = parsedLimit;

  const parsedOffset = parsePositiveInt(offset);
  if (parsedOffset !== undefined) filters.offset = parsedOffset;

  try {
    const result = await getLogs(filters);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /stats
 *
 * Returns aggregate request statistics over the filtered log set, including
 * total requests, total tokens, total estimated cost, and per-provider and
 * per-model breakdowns. Accepts optional `startDate` and `endDate` ISO-8601
 * query parameters to scope the window.
 */
logsRouter.get("/stats", async (c) => {
  const { startDate, endDate, groupBy } = c.req.query();

  const filters: StatsFilters = {};

  const parsedStart = parseDate(startDate);
  if (parsedStart) filters.startDate = parsedStart;

  const parsedEnd = parseDate(endDate);
  if (parsedEnd) filters.endDate = parsedEnd;

  // Narrow the raw string into the documented union before passing through so
  // unknown values are silently dropped instead of forwarding user input to
  // the service layer.
  if (groupBy === "provider" || groupBy === "model" || groupBy === "apiKey") {
    filters.groupBy = groupBy;
  }

  try {
    const stats = await getStats(filters);
    return c.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});
