import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { mockRegisterMutation } = vi.hoisted(() => ({
  mockRegisterMutation: {
    mutate: vi.fn(),
    isPending: false,
  },
}));

vi.mock("@repo/ui/components/button", () => ({
  Button: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("button", { type: "button", ...props }, children),
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
vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => React.createElement("span", { "data-testid": "icon" }),
}));
vi.mock("@hugeicons/core-free-icons", () => ({
  Copy01Icon: {},
  Key01Icon: {},
}));

vi.mock("../../../../src/modules/auth/hooks/use-auth", () => ({
  useRegisterMutation: () => mockRegisterMutation,
}));

import { RegisterForm } from "../../../../src/modules/auth/components/register-form";

function submitFormByButton(name: string) {
  const button = screen.getByRole("button", { name });
  const form = button.closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

describe("RegisterForm", () => {
  beforeEach(() => {
    mockRegisterMutation.mutate.mockReset();
    mockRegisterMutation.isPending = false;
    window.history.replaceState(null, "", "/register");
  });

  it("renders register form", () => {
    render(React.createElement(RegisterForm));
    expect(screen.getByText("Create user account")).toBeDefined();
  });

  it("submits account details", () => {
    render(React.createElement(RegisterForm));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Admin" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@test.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Invitation code"), { target: { value: "MUX-TEST" } });
    submitFormByButton("Register");

    expect(mockRegisterMutation.mutate).toHaveBeenCalledWith(
      {
        name: "Admin",
        email: "admin@test.com",
        password: "password123",
        invitationCode: "MUX-TEST",
      },
      expect.objectContaining({ onError: expect.any(Function), onSuccess: expect.any(Function) }),
    );
  });

  it("prefills code from query params and reveals the API key after success", () => {
    window.history.replaceState(null, "", "/register?code=MUX-PREFILL");
    mockRegisterMutation.mutate.mockImplementationOnce((_input, options) => {
      options.onSuccess({
        user: { id: "u1" },
        apiKey: { id: "k1", key: "mux_live_test", spendLimitUsd: 5 },
      });
    });

    render(React.createElement(RegisterForm));

    expect((screen.getByLabelText("Invitation code") as HTMLInputElement).value).toBe(
      "MUX-PREFILL",
    );
    submitFormByButton("Register");

    expect(screen.getByText("Save this API key")).toBeDefined();
    expect(screen.getByText("mux_live_test")).toBeDefined();
    expect(screen.getByText("Balance: $5.00")).toBeDefined();
  });

  it("shows error branches and pending label", () => {
    mockRegisterMutation.isPending = true;
    mockRegisterMutation.mutate.mockImplementationOnce((_input, options) => {
      options.onError("failed");
    });

    render(React.createElement(RegisterForm));
    expect(
      (screen.getByRole("button", { name: "Creating..." }) as HTMLButtonElement).disabled,
    ).toBe(true);

    submitFormByButton("Creating...");

    expect(screen.getByText("Registration failed.")).toBeDefined();
  });

  it("shows error messages from registration errors", () => {
    mockRegisterMutation.mutate.mockImplementationOnce((_input, options) => {
      options.onError(new Error("Email already exists"));
    });

    render(React.createElement(RegisterForm));
    submitFormByButton("Register");

    expect(screen.getByText("Email already exists")).toBeDefined();
  });
});
