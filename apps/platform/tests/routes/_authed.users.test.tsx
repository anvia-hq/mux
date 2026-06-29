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
vi.mock("../../src/modules/users/users-page", () => ({
  UsersPage: () => null,
}));

import "../../src/routes/_authed.users";
import { UsersPage } from "../../src/modules/users/users-page";

describe("users route", () => {
  it("registers the users page component", () => {
    expect(mockCreateFileRoute).toHaveBeenCalledWith("/_authed/users");
    expect(mockRouteConfig.current?.component).toBe(UsersPage);
  });
});
