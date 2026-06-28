import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const { mockToast } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => React.createElement("span", { "data-testid": "copy-icon" }),
}));
vi.mock("sonner", () => ({ toast: mockToast }));

import { ModelIdCopyButton } from "../../../src/modules/models/model-id-copy-button";

describe("ModelIdCopyButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
  });

  it("copies the model id and shows a success toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(React.createElement(ModelIdCopyButton, { modelId: "openai:gpt-4" }));
    fireEvent.click(screen.getByRole("button", { name: "openai:gpt-4" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("openai:gpt-4"));
    expect(mockToast.success).toHaveBeenCalledWith("Model ID copied", {
      description: "openai:gpt-4",
    });
  });

  it("shows an error toast when clipboard write fails", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(React.createElement(ModelIdCopyButton, { modelId: "openai:gpt-4" }));
    fireEvent.click(screen.getByRole("button", { name: "openai:gpt-4" }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Could not copy model ID"));
  });
});
