import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

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
  Label: ({ children }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("label", null, children),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("a", null, children),
}));

vi.mock("../hooks/use-auth", () => ({
  useRegisterMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { RegisterForm } from "./register-form";

describe("RegisterForm", () => {
  it("renders register form", () => {
    render(React.createElement(RegisterForm));
    expect(screen.getByText("Create user account")).toBeDefined();
  });
});
