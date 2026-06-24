import { describe, expect, it } from "vitest";
import { authQueryKey, authApiPaths } from "./schema";

describe("auth schema", () => {
  it("exports auth query key", () => {
    expect(authQueryKey).toEqual(["auth"]);
  });

  it("exports api paths", () => {
    expect(authApiPaths.login).toBe("/auth/login");
    expect(authApiPaths.logout).toBe("/auth/logout");
    expect(authApiPaths.me).toBe("/auth/me");
    expect(authApiPaths.register).toBe("/auth/register");
    expect(authApiPaths.onboard).toBe("/auth/onboard");
    expect(authApiPaths.onboardingStatus).toBe("/auth/onboarding-status");
  });
});
