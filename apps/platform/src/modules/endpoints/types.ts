import type { EndpointMode, ToolCachePolicy } from "@mux/core/types";

export interface EndpointItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  mode: EndpointMode;
  enabled: boolean;
  createdAt: string;
}

export interface EndpointToolBinding {
  id: string;
  endpointId: string;
  toolId: string;
  enabled: boolean;
  cachePolicyOverride: ToolCachePolicy | null;
}

export interface CreateEndpointInput {
  slug: string;
  name: string;
  description?: string;
  mode: EndpointMode;
}
