import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const { mockUsersQuery } = vi.hoisted(() => ({
  mockUsersQuery: {
    data: { users: [] as unknown[] },
    error: null as unknown,
    isLoading: false,
  },
}));

vi.mock("@repo/ui/components/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
}));
vi.mock("@repo/ui/components/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) =>
    React.createElement("section", null, children),
  CardDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement("p", null, children),
  CardHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("header", null, children),
  CardTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h2", null, children),
}));
vi.mock("@repo/ui/components/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) =>
    React.createElement("table", null, children),
  TableBody: ({ children }: { children: React.ReactNode }) =>
    React.createElement("tbody", null, children),
  TableCell: ({ children }: { children: React.ReactNode }) =>
    React.createElement("td", null, children),
  TableHead: ({ children }: { children: React.ReactNode }) =>
    React.createElement("th", null, children),
  TableHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("thead", null, children),
  TableRow: ({ children }: { children: React.ReactNode }) =>
    React.createElement("tr", null, children),
}));
vi.mock("../../../src/modules/users/hooks", () => ({
  useUsersQuery: () => mockUsersQuery,
  isForbiddenError: (error: unknown) =>
    typeof error === "object" && error !== null && "status" in error && error.status === 403,
}));

import { UsersPage } from "../../../src/modules/users/users-page";

const users = [
  {
    id: "admin-1",
    email: "admin@test.com",
    name: "Admin User",
    role: "ADMIN",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "user-1",
    email: "user@test.com",
    name: null,
    role: "USER",
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-04T00:00:00.000Z",
  },
];

describe("UsersPage", () => {
  beforeEach(() => {
    mockUsersQuery.data = { users: [] };
    mockUsersQuery.error = null;
    mockUsersQuery.isLoading = false;
  });

  it("renders loading, empty, and populated states", () => {
    mockUsersQuery.isLoading = true;
    const { rerender } = render(React.createElement(UsersPage));
    expect(screen.getByText("Loading...")).toBeDefined();

    mockUsersQuery.isLoading = false;
    rerender(React.createElement(UsersPage));
    expect(screen.getByText("No users yet.")).toBeDefined();

    mockUsersQuery.data = { users };
    rerender(React.createElement(UsersPage));
    expect(screen.getByText("2 users")).toBeDefined();
    expect(screen.getByText("Admin User")).toBeDefined();
    expect(screen.getByText("admin@test.com")).toBeDefined();
    expect(screen.getByText("user@test.com")).toBeDefined();
    expect(screen.getByText("Not set")).toBeDefined();
    expect(screen.getByText("Admin")).toBeDefined();
    expect(screen.getByText("User")).toBeDefined();
  });

  it("renders admin-only state for forbidden responses", () => {
    mockUsersQuery.error = { status: 403 };

    render(React.createElement(UsersPage));

    expect(screen.getByText("Admin only")).toBeDefined();
    expect(screen.getByText("User management is restricted to administrators.")).toBeDefined();
  });
});
