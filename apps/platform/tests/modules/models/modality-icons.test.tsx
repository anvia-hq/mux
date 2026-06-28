import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => React.createElement("span", { "data-testid": "icon" }),
}));
vi.mock("@repo/ui/components/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
  TooltipProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import { ModalityIcons } from "../../../src/modules/models/modality-icons";

describe("ModalityIcons", () => {
  it("renders fallback text when no modalities are present", () => {
    render(React.createElement(ModalityIcons, { modalities: [] }));
    expect(screen.getByText("-")).toBeDefined();
  });

  it("renders known and unknown modality labels", () => {
    render(React.createElement(ModalityIcons, { modalities: ["text", "IMAGE", "spreadsheet"] }));

    expect(screen.getByRole("img", { name: "Text" })).toBeDefined();
    expect(screen.getByRole("img", { name: "IMAGE" })).toBeDefined();
    expect(screen.getByRole("img", { name: "Spreadsheet" })).toBeDefined();
    expect(screen.getAllByTestId("icon")).toHaveLength(3);
  });
});
