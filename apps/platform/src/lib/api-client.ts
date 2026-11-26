export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

const extractErrorDetails = (
  payload: unknown,
  status: number,
): { code: string; message: string } => {
  if (typeof payload === "object" && payload !== null) {
    if ("error" in payload && typeof payload.error === "object" && payload.error !== null) {
      const errObj = payload.error as Record<string, unknown>;
      const code = typeof errObj.code === "string" ? errObj.code : `HTTP_${status}`;
      const message =
        typeof errObj.message === "string" ? errObj.message : `Request failed (${status}).`;

      return { code, message };
    }

    if ("message" in payload && typeof payload.message === "string") {
      const code =
        "code" in payload && typeof payload.code === "string" ? payload.code : `HTTP_${status}`;

      return { code, message: payload.message };
    }
  }

  return { code: `HTTP_${status}`, message: `Request failed (${status}).` };
};

export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const headers = new Headers();
  let body: string | undefined;

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }

  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(path, {
    method: options.method ?? "GET",
    headers,
    body,
    credentials: "include",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = null;

  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const details = extractErrorDetails(parsed, response.status);

    throw new ApiRequestError(response.status, details.code, details.message);
  }

  return parsed as T;
};
