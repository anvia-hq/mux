import { describe, expect, it, vi } from "vitest";
import type { ResolvedProviderModel } from "../../../../src/providers/registry";
import { createChatCandidateSelector } from "../../../../src/modules/chat/relay/routing";

function candidate(
  id: string,
  priority: number,
  weight: number,
  fallbackPosition = 0,
): ResolvedProviderModel {
  return {
    channelId: id,
    channelName: id,
    providerName: "test",
    modelId: "m",
    upstreamModelId: "m",
    publicModelId: "test:m",
    priority,
    weight,
    fallbackPosition,
    provider: {} as ResolvedProviderModel["provider"],
  };
}

describe("chat candidate selector", () => {
  it("selects by weight without replacement before advancing priority", () => {
    const random = vi.fn().mockReturnValueOnce(0.95).mockReturnValue(0);
    const selector = createChatCandidateSelector(
      [candidate("heavy", 10, 9), candidate("light", 10, 1), candidate("backup", 1, 1)],
      random,
    );
    expect(selector.next()?.channelId).toBe("light");
    expect(selector.next()?.channelId).toBe("heavy");
    expect(selector.next()?.channelId).toBe("backup");
    expect(selector.next()).toBeNull();
  });

  it("preserves fallback target order before channel priority", () => {
    const selector = createChatCandidateSelector(
      [candidate("second", 100, 1, 1), candidate("first", 1, 1, 0)],
      () => 0,
    );
    expect(selector.next()?.channelId).toBe("first");
    expect(selector.next()?.channelId).toBe("second");
  });
});
