import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser, login, logout, register, onboardingStatus, onboard } from "./services";

vi.mock("../../lib/api-client", () => ({
  apiFetch: vi.fn(),
  UnauthorizedError: class extends Error { constructor() { super("Unauthorized"); this.name = "UnauthorizedError"; } },
}));

import { apiFetch, UnauthorizedError } from "../../lib/api-client";

describe("auth services", () => {
  afterEach(() => vi.clearAllMocks());

  it("getCurrentUser calls /auth/me", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ user: { id: "1" } });
    const user = await getCurrentUser();
    expect(user).toEqual({ id: "1" });
  });

  it("getCurrentUser rethrows UnauthorizedError", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new UnauthorizedError());
    await expect(getCurrentUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("login calls POST /auth/login", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ user: { id: "1" } });
    await login({ email: "a@b.com", password: "s" });
    expect(apiFetch).toHaveBeenCalledWith("/auth/login", { method: "POST", body: { email: "a@b.com", password: "s" } });
  });

  it("register calls POST /auth/register", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ user: { id: "2" } });
    await register({ email: "new@b.com", password: "p" });
    expect(apiFetch).toHaveBeenCalledWith("/auth/register", { method: "POST", body: { email: "new@b.com", password: "p" } });
  });

  it("logout calls POST /auth/logout", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
    await logout();
    expect(apiFetch).toHaveBeenCalledWith("/auth/logout", { method: "POST" });
  });

  it("onboardingStatus calls /auth/onboarding-status", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ needsOnboarding: true });
    expect(await onboardingStatus()).toEqual({ needsOnboarding: true });
  });

  it("onboard calls POST /auth/onboard", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ user: { id: "3" } });
    await onboard({ email: "a@b.com", password: "p" });
    expect(apiFetch).toHaveBeenCalledWith("/auth/onboard", { method: "POST", body: { email: "a@b.com", password: "p" } });
  });

  it("getCurrentUser rethrows non-Unauthorized errors", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Network error"));
    await expect(getCurrentUser()).rejects.toThrow("Network error");
  });
});