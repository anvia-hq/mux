import { describe, expect, it, vi } from "vitest";

type RegisterRouteConfig = {
  beforeLoad: (args: {
    context: {
      queryClient: {
        ensureQueryData: (options: unknown) => Promise<{ needsOnboarding: boolean }>;
      };
    };
  }) => Promise<never>;
  component: unknown;
};

const { mockCreateFileRoute, mockRedirect, mockRouteConfig, mockStatusQueryOptions } = vi.hoisted(
  () => {
    const routeConfig: { current: RegisterRouteConfig | null } = { current: null };

    return {
      mockRedirect: vi.fn((options: { to: string }) => options),
      mockRouteConfig: routeConfig,
      mockStatusQueryOptions: { queryKey: ["auth", "onboarding-status"] },
      mockCreateFileRoute: vi.fn(() =>
        vi.fn((config: RegisterRouteConfig) => {
          routeConfig.current = config;
          return config;
        }),
      ),
    };
  },
);

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: mockCreateFileRoute,
  redirect: mockRedirect,
}));

vi.mock("../../src/modules/auth/hooks/use-auth", () => ({
  onboardingStatusQueryOptions: mockStatusQueryOptions,
}));

import "../../src/routes/register";

async function runBeforeLoad(needsOnboarding: boolean) {
  const ensureQueryData = vi.fn().mockResolvedValue({ needsOnboarding });

  let thrown: unknown;
  try {
    await mockRouteConfig.current?.beforeLoad({
      context: { queryClient: { ensureQueryData } },
    });
  } catch (error) {
    thrown = error;
  }

  expect(ensureQueryData).toHaveBeenCalledWith(mockStatusQueryOptions);
  return thrown;
}

describe("register route", () => {
  it("redirects to onboarding when no users exist", async () => {
    await expect(runBeforeLoad(true)).resolves.toEqual({ to: "/onboard" });
    expect(mockRedirect).toHaveBeenCalledWith({ to: "/onboard" });
  });

  it("redirects to login when users already exist", async () => {
    await expect(runBeforeLoad(false)).resolves.toEqual({ to: "/login" });
    expect(mockRedirect).toHaveBeenCalledWith({ to: "/login" });
  });
});
