import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../../src/modules/auth/services", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "1", email: "a@b.com", role: "USER" }),
  login: vi.fn().mockResolvedValue({ id: "1", email: "a@b.com", role: "USER" }),
  register: vi.fn().mockResolvedValue({ id: "2", email: "new@b.com", role: "USER" }),
  logout: vi.fn().mockResolvedValue(undefined),
  onboard: vi.fn().mockResolvedValue({ id: "3", email: "admin@test.com", role: "ADMIN" }),
  onboardingStatus: vi.fn().mockResolvedValue({ needsOnboarding: false }),
}));

import {
  meQueryOptions,
  onboardingStatusQueryOptions,
  useLoginMutation,
  useLogoutMutation,
  useRegisterMutation,
  useOnboardMutation,
} from "../../../../src/modules/auth/hooks/use-auth";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  );

describe("auth hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  it("meQueryOptions has correct config", () => {
    expect(meQueryOptions.queryKey).toEqual(["auth", "me"]);
    expect(meQueryOptions.retry).toBe(false);
  });

  it("onboardingStatusQueryOptions has correct config", () => {
    expect(onboardingStatusQueryOptions.queryKey).toEqual(["auth", "onboarding-status"]);
    expect(onboardingStatusQueryOptions.retry).toBe(false);
  });

  it("useLoginMutation triggers navigate on success", async () => {
    const { result } = renderHook(() => useLoginMutation(), { wrapper });
    await act(() => result.current.mutateAsync({ email: "a@b.com", password: "s" }));
    expect(mockNavigate).toHaveBeenCalled();
  });

  it("useRegisterMutation triggers navigate on success", async () => {
    const { result } = renderHook(() => useRegisterMutation(), { wrapper });
    await act(() => result.current.mutateAsync({ email: "a@b.com", password: "password" }));
    expect(mockNavigate).toHaveBeenCalled();
  });

  it("useOnboardMutation triggers navigate on success", async () => {
    const { result } = renderHook(() => useOnboardMutation(), { wrapper });
    await act(() => result.current.mutateAsync({ email: "a@b.com", password: "password123" }));
    expect(mockNavigate).toHaveBeenCalled();
  });

  it("useLogoutMutation triggers navigate to /login", async () => {
    const { result } = renderHook(() => useLogoutMutation(), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/login" });
  });
});
