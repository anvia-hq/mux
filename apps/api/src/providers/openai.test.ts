import { describe, expect, it, vi } from "vitest";

vi.mock("../models-dev-provider-adapter", () => ({
  ModelsDevProviderAdapter: class {
    name: string;
    constructor(input: { name: string }) { this.name = input.name; }
    listModels() { return []; }
  },
}));

import { OpenAIAdapter } from "./openai";

describe("OpenAIAdapter", () => {
  it("creates adapter with name openai", () => {
    const adapter = new OpenAIAdapter("sk-test");
    expect(adapter.name).toBe("openai");
  });
});