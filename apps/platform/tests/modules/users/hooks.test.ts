import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("../../../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
}));

import { apiFetch, ApiError } from "../../../src/lib/api-client";
import { isForbiddenError, useUsersQuery } from "../../../src/modules/users/hooks";

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

describe("users hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches /users", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ users: [] });

    const { result } = renderHook(() => useUsersQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/users");
  });

  it("recognizes forbidden API errors", () => {
    expect(isForbiddenError(new ApiError(403, "forbidden", null))).toBe(true);
    expect(isForbiddenError(new ApiError(500, "server error", null))).toBe(false);
    expect(isForbiddenError(new Error("test"))).toBe(false);
  });
});
