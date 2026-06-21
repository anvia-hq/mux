import { describe, expect, it, vi } from "vitest";

vi.mock("../models-dev-provider-adapter", () => ({
  ModelsDevProviderAdapter: class {
    name: string;
    constructor(input: { name: string }) { this.name = input.name; }
    listModels() { return []; }
  },
}));

import { MistralAdapter } from "./mistral";

describe("MistralAdapter", () => {
  it("creates adapter with name mistral", () => {
    const adapter = new MistralAdapter("sk-test");
    expect(adapter.name).toBe("mistral");
  });
});