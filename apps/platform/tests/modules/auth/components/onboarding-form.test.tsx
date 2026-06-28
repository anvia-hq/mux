import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { mockOnboardMutation } = vi.hoisted(() => ({
  mockOnboardMutation: {
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
  CardDescription: ({ children }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("p", null, children),
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

vi.mock("../../../../src/modules/auth/hooks/use-auth", () => ({
  useOnboardMutation: () => mockOnboardMutation,
}));

import { OnboardingForm } from "../../../../src/modules/auth/components/onboarding-form";

function submitFormByButton(name: string) {
  const button = screen.getByRole("button", { name });
  const form = button.closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

describe("OnboardingForm", () => {
  beforeEach(() => {
    mockOnboardMutation.mutate.mockReset();
    mockOnboardMutation.isPending = false;
  });

  it("renders onboarding form", () => {
    render(React.createElement(OnboardingForm));
    expect(screen.getByText("Welcome to Mux Gateway")).toBeDefined();
  });

  it("submits trimmed optional name", () => {
    render(React.createElement(OnboardingForm));

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@test.com" } });
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: " Admin " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    submitFormByButton("Create admin account");

    expect(mockOnboardMutation.mutate).toHaveBeenCalledWith(
      { email: "admin@test.com", password: "password123", name: "Admin" },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("sends undefined name when the optional name is blank", () => {
    render(React.createElement(OnboardingForm));

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@test.com" } });
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    submitFormByButton("Create admin account");

    expect(mockOnboardMutation.mutate).toHaveBeenCalledWith(
      { email: "admin@test.com", password: "password123", name: undefined },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("shows error branches and pending label", () => {
    mockOnboardMutation.isPending = true;
    mockOnboardMutation.mutate.mockImplementationOnce((_input, options) => {
      options.onError("failed");
    });

    render(React.createElement(OnboardingForm));
    expect(
      (screen.getByRole("button", { name: "Creating..." }) as HTMLButtonElement).disabled,
    ).toBe(true);

    submitFormByButton("Creating...");

    expect(screen.getByText("Onboarding failed.")).toBeDefined();
  });

  it("shows errors from onboarding failures", () => {
    mockOnboardMutation.mutate.mockImplementationOnce((_input, options) => {
      options.onError(new Error("Admin exists"));
    });

    render(React.createElement(OnboardingForm));
    submitFormByButton("Create admin account");

    expect(screen.getByText("Admin exists")).toBeDefined();
  });
});
