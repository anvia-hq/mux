import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { mockLoginMutation, mockOnboardingStatusQuery } = vi.hoisted(() => ({
  mockLoginMutation: {
    mutate: vi.fn(),
    isPending: false,
  },
  mockOnboardingStatusQuery: {
    data: { inviteRegistrationEnabled: true },
  },
}));

vi.mock("@repo/ui/components/button", () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode; asChild?: boolean }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, props);
    }

    return React.createElement("button", { type: "button", ...props }, children);
  },
}));
vi.mock("@repo/ui/components/card", () => ({
  Card: ({ children }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  CardContent: ({ children }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  CardHeader: ({ children }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  CardTitle: ({ children }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("h2", null, children),
}));
vi.mock("@repo/ui/components/input", () => ({
  Input: (props: Record<string, unknown>) => React.createElement("input", props),
}));
vi.mock("@repo/ui/components/label", () => ({
  Label: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("label", props, children),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("a", { href: String(to ?? "") }, children),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => mockOnboardingStatusQuery,
}));

vi.mock("../../../../src/modules/auth/hooks/use-auth", () => ({
  onboardingStatusQueryOptions: { queryKey: ["auth", "onboarding-status"] },
  useLoginMutation: () => mockLoginMutation,
}));

import { LoginForm } from "../../../../src/modules/auth/components/login-form";

function submitFormByButton(name: string) {
  const button = screen.getByRole("button", { name });
  const form = button.closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

describe("LoginForm", () => {
  beforeEach(() => {
    mockLoginMutation.mutate.mockReset();
    mockLoginMutation.isPending = false;
    mockOnboardingStatusQuery.data = { inviteRegistrationEnabled: true };
  });

  it("renders login form", () => {
    render(React.createElement(LoginForm));
    expect(screen.getByText("Platform login")).toBeDefined();
    expect(screen.getByText("Create account with invite code")).toBeDefined();
  });

  it("hides create account link when invite-code registration is disabled", () => {
    mockOnboardingStatusQuery.data = { inviteRegistrationEnabled: false };

    render(React.createElement(LoginForm));

    expect(screen.queryByText("Create account with invite code")).toBeNull();
  });

  it("submits email and password", () => {
    render(React.createElement(LoginForm));

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@test.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    submitFormByButton("Login");

    expect(mockLoginMutation.mutate).toHaveBeenCalledWith(
      { email: "admin@test.com", password: "password123" },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("shows errors from failed login attempts", () => {
    mockLoginMutation.mutate.mockImplementationOnce((_input, options) => {
      options.onError(new Error("Invalid credentials"));
    });

    render(React.createElement(LoginForm));
    submitFormByButton("Login");

    expect(screen.getByText("Invalid credentials")).toBeDefined();
  });

  it("shows fallback error text for non-error failures and pending label", () => {
    mockLoginMutation.isPending = true;
    mockLoginMutation.mutate.mockImplementationOnce((_input, options) => {
      options.onError("failed");
    });

    render(React.createElement(LoginForm));
    expect(
      (screen.getByRole("button", { name: "Logging in..." }) as HTMLButtonElement).disabled,
    ).toBe(true);

    submitFormByButton("Logging in...");

    expect(screen.getByText("Authentication failed.")).toBeDefined();
  });
});
