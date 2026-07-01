import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
import {
  isForbiddenError,
  useCreateInvitationMutation,
  useInvitationsQuery,
  useRevokeInvitationMutation,
} from "../../../src/modules/invitations/hooks";

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

describe("invitations hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches /invitations", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ invitations: [] });

    const { result } = renderHook(() => useInvitationsQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/invitations");
  });

  it("posts and deletes invitations", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ invitation: { id: "invite-1" }, code: "MUX" });
    const created = renderHook(() => useCreateInvitationMutation(), { wrapper });

    await act(() => created.result.current.mutateAsync({ balanceUsd: 5 }));
    expect(apiFetch).toHaveBeenCalledWith("/invitations", {
      method: "POST",
      body: { balanceUsd: 5 },
    });

    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
    const revoked = renderHook(() => useRevokeInvitationMutation(), { wrapper });

    await act(() => revoked.result.current.mutateAsync("invite-1"));
    expect(apiFetch).toHaveBeenCalledWith("/invitations/invite-1", { method: "DELETE" });
  });

  it("recognizes forbidden API errors", () => {
    expect(isForbiddenError(new ApiError(403, "forbidden", null))).toBe(true);
    expect(isForbiddenError(new ApiError(500, "server error", null))).toBe(false);
    expect(isForbiddenError(new Error("test"))).toBe(false);
  });
});
