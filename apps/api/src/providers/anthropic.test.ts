import { describe, expect, it, vi } from "vitest";

vi.mock("../models-dev-provider-adapter", () => ({
  ModelsDevProviderAdapter: class {
    name: string;
    constructor(input: { name: string }) { this.name = input.name; }
    listModels() { return []; }
  },
}));

import { AnthropicAdapter } from "./anthropic";

describe("AnthropicAdapter", () => {
  it("creates adapter with name anthropic", () => {
    const adapter = new AnthropicAdapter("sk-test");
    expect(adapter.name).toBe("anthropic");
  });
});