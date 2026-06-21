/**
 * Tiny fetch wrapper for the platform UI.
 *
 * - Uses `VITE_API_URL` as the API base. Set it to `/api` when requests should
 *   go through Caddy, or to an absolute URL (e.g. `http://localhost:8000`) to
 *   call the API directly in dev.
 * - Always sends cookies (so the auth cookie round-trips).
 * - Throws `UnauthorizedError` on 401 so route guards can redirect to login.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const apiBaseUrl = import.meta.env.VITE_API_URL?.trim();

if (!apiBaseUrl) {
  throw new Error("VITE_API_URL must be configured for apps/platform");
}

export const apiBase =
  apiBaseUrl === "/" ? "" : apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;

  const { body, headers, ...rest } = options;

  const response = await fetch(url, {
    ...rest,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401) {
    throw new UnauthorizedError();
  }

  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, data);
  }

  return data as T;
}
