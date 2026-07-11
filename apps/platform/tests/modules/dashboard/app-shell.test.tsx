import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const { mockLocation, mockLogout, mockUser } = vi.hoisted(() => ({
  mockLocation: { pathname: "/" },
  mockLogout: { isPending: false, mutate: vi.fn() },
  mockUser: {
    data: {
      id: "admin-1",
      email: "admin@test.com",
      name: "Admin",
      role: "ADMIN",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => mockUser,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode; to: string }) =>
    React.createElement("a", { href: to, ...props }, children),
  Outlet: () => React.createElement("div", { "data-testid": "outlet" }),
  useLocation: () => mockLocation,
}));
vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => React.createElement("span", { "data-testid": "icon" }),
}));
vi.mock("@hugeicons/core-free-icons", () => ({
  BookOpen01Icon: {},
  BoxesIcon: {},
  DashboardSquare01Icon: {},
  Flowchart02Icon: {},
  Key01Icon: {},
  Link01Icon: {},
  Logout01Icon: {},
  PlayIcon: {},
  Plug01Icon: {},
  Scroll01Icon: {},
  Settings01Icon: {},
  User02Icon: {},
}));
vi.mock("@repo/ui/components/button", () => ({
  Button: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("button", { type: "button", ...props }, children),
}));
vi.mock("@repo/ui/components/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) =>
    React.createElement("section", null, children),
}));
vi.mock("@repo/ui/components/sidebar", () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) =>
    React.createElement("aside", null, children),
  SidebarContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  SidebarFooter: ({ children }: { children: React.ReactNode }) =>
    React.createElement("footer", null, children),
  SidebarGroup: ({ children }: { children: React.ReactNode }) =>
    React.createElement("section", null, children),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h2", null, children),
  SidebarHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("header", null, children),
  SidebarInset: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  SidebarMenu: ({ children }: { children: React.ReactNode }) =>
    React.createElement("nav", null, children),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  SidebarProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  SidebarTrigger: () => React.createElement("button", { type: "button" }, "Menu"),
}));
vi.mock("../../../src/modules/auth/hooks/use-auth", () => ({
  meQueryOptions: { queryKey: ["me"] },
  useLogoutMutation: () => mockLogout,
}));

import { AppShell } from "../../../src/modules/dashboard/components/app-shell";

describe("AppShell", () => {
  it("shows Users navigation for admins", () => {
    mockUser.data.role = "ADMIN";

    render(React.createElement(AppShell));

    expect(screen.getByRole("link", { name: "Users" }).getAttribute("href")).toBe("/users");
  });

  it("hides admin navigation and shows Playground for regular users", () => {
    mockUser.data.role = "USER";

    render(React.createElement(AppShell));

    expect(screen.getByRole("link", { name: "API keys" }).getAttribute("href")).toBe("/api-keys");
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
    expect(screen.getByRole("link", { name: "Playground" }).getAttribute("href")).toBe(
      "/playground",
    );
  });

  it("shows Playground navigation for admins", () => {
    mockUser.data.role = "ADMIN";

    render(React.createElement(AppShell));

    expect(screen.getByRole("link", { name: "Playground" }).getAttribute("href")).toBe(
      "/playground",
    );
  });

  it("shows model alias navigation for admins", () => {
    mockUser.data.role = "ADMIN";

    render(React.createElement(AppShell));

    expect(screen.getByRole("link", { name: "Aliases" }).getAttribute("href")).toBe(
      "/model-aliases",
    );
  });

  it("shows the unified documentation navigation", () => {
    mockUser.data.role = "USER";

    render(React.createElement(AppShell));

    expect(screen.getByRole("link", { name: "Documentation" }).getAttribute("href")).toBe("/docs");
    expect(screen.queryByRole("link", { name: "Service Docs" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Coding Harness" })).toBeNull();
  });
});
