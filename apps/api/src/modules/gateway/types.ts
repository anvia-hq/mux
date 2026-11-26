import type { ToolCache } from "@mux/core/cache/types";
import type { ApiKeysService } from "../api-keys/types";
import type { EndpointsService } from "../endpoints/types";
import type { ToolExecutionService } from "../executions/types";
import type { ToolsRepository } from "../tools/types";

export interface GatewayRouterDeps {
  apiKeysService: ApiKeysService;
  endpointsService: EndpointsService;
  toolsRepo: Pick<ToolsRepository, "listCanonicalToolsForEndpoint">;
  toolCache: Pick<ToolCache, "getEndpointCatalog" | "setEndpointCatalog">;
  executionService: ToolExecutionService;
}
