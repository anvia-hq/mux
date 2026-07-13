import type { ResolvedProviderModel } from "../../../providers/registry";

type CandidateTier = {
  routeOrder: number;
  priority: number;
  candidates: ResolvedProviderModel[];
};

export type ChatCandidateSelector = {
  next(): ResolvedProviderModel | null;
};

function weightedIndex(candidates: ResolvedProviderModel[], random: () => number): number {
  const total = candidates.reduce((sum, candidate) => sum + Math.max(candidate.weight ?? 1, 1), 0);
  let cursor = Math.min(Math.max(random(), 0), 0.999999999999) * total;
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= Math.max(candidates[index].weight ?? 1, 1);
    if (cursor < 0) return index;
  }
  return candidates.length - 1;
}

export function createChatCandidateSelector(
  candidates: ResolvedProviderModel[],
  random: () => number = Math.random,
): ChatCandidateSelector {
  const tierMap = new Map<string, CandidateTier>();
  for (const [index, candidate] of candidates.entries()) {
    const hasRuntimeRoutingMetadata =
      candidate.fallbackPosition !== undefined ||
      candidate.priority !== undefined ||
      candidate.weight !== undefined;
    const routeOrder = candidate.fallbackPosition ?? (hasRuntimeRoutingMetadata ? 0 : index);
    const priority = candidate.priority ?? 0;
    const key = `${routeOrder}:${priority}`;
    const tier = tierMap.get(key) ?? { routeOrder, priority, candidates: [] };
    tier.candidates.push(candidate);
    tierMap.set(key, tier);
  }
  const tiers = Array.from(tierMap.values()).sort(
    (left, right) => left.routeOrder - right.routeOrder || right.priority - left.priority,
  );

  return {
    next() {
      while (tiers.length > 0) {
        const tier = tiers[0];
        if (tier.candidates.length === 0) {
          tiers.shift();
          continue;
        }
        const index = weightedIndex(tier.candidates, random);
        return tier.candidates.splice(index, 1)[0] ?? null;
      }
      return null;
    },
  };
}
