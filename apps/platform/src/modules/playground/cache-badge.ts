import type { ToolCacheStatus } from "@mux/core/types";

export const cacheStatusBadgeVariant = (status: ToolCacheStatus) => {
  if (status === "hit") {
    return "success" as const;
  }

  if (status === "stale" || status === "bypass") {
    return "warning" as const;
  }

  return "muted" as const;
};
