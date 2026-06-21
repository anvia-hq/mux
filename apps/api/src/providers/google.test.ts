import { describe, expect, it, vi } from "vitest";

vi.mock("../models-dev-provider-adapter", () => ({
  ModelsDevProviderAdapter: class {
    name: string;
    constructor(input: { name: string }) { this.name = input.name; }
    listModels() { return []; }
  },
}));

import { GoogleAdapter } from "./google";

describe("GoogleAdapter", () => {
  it("creates adapter with name google", () => {
    const adapter = new GoogleAdapter("sk-test");
    expect(adapter.name).toBe("google");
  });
});