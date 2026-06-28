import { describe, expect, it, vi } from "vitest";

const { mockCreateFileRoute, mockRouteConfig } = vi.hoisted(() => ({
  mockCreateFileRoute: vi.fn(() =>
    vi.fn((config) => {
      mockRouteConfig.current = config;
      return config;
    }),
  ),
  mockRouteConfig: { current: null as null | { component: unknown } },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: mockCreateFileRoute,
}));
vi.mock("../../src/modules/fallback-groups/fallback-groups-page", () => ({
  FallbackGroupsPage: () => null,
}));

import "../../src/routes/_authed.fallback-groups";
import { FallbackGroupsPage } from "../../src/modules/fallback-groups/fallback-groups-page";

describe("fallback groups route", () => {
  it("registers the fallback groups page component", () => {
    expect(mockCreateFileRoute).toHaveBeenCalledWith("/_authed/fallback-groups");
    expect(mockRouteConfig.current?.component).toBe(FallbackGroupsPage);
  });
});
