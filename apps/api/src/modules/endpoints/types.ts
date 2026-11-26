import type { ToolCache } from "@mux/core/cache/types";
import type { EndpointMode, ToolCachePolicy } from "@mux/core/types";
import type { AuthenticatedUser, SessionResolver } from "../../auth";

export interface EndpointRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  mode: EndpointMode;
  enabled: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EndpointToolRecord {
  id: string;
  endpointId: string;
  toolId: string;
  enabled: boolean;
  cachePolicyOverride: ToolCachePolicy | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEndpointInput {
  slug: string;
  name: string;
  description?: string | null;
  mode?: EndpointMode;
  enabled?: boolean;
}

export interface InsertEndpointData {
  slug: string;
  name: string;
  description: string | null;
  mode: EndpointMode;
  enabled: boolean;
  createdById: string;
}

export interface UpdateEndpointInput {
  name?: string;
  description?: string | null;
  mode?: EndpointMode;
  enabled?: boolean;
}

export interface UpsertEndpointToolInput {
  enabled?: boolean;
  cachePolicyOverride?: ToolCachePolicy | null;
}

export interface EndpointsRepository {
  list: () => Promise<EndpointRecord[]>;
  findById: (id: string) => Promise<EndpointRecord | null>;
  findBySlug: (slug: string) => Promise<EndpointRecord | null>;
  insert: (data: InsertEndpointData) => Promise<EndpointRecord>;
  update: (id: string, input: UpdateEndpointInput) => Promise<EndpointRecord | null>;
  remove: (id: string) => Promise<boolean>;
  listTools: (endpointId: string) => Promise<EndpointToolRecord[]>;
  toolExists: (toolId: string) => Promise<boolean>;
  upsertTool: (
    endpointId: string,
    toolId: string,
    input: { enabled: boolean; cachePolicyOverride: ToolCachePolicy | null },
  ) => Promise<EndpointToolRecord>;
  removeTool: (endpointId: string, toolId: string) => Promise<boolean>;
}

export interface EndpointsService {
  list: () => Promise<EndpointRecord[]>;
  getById: (id: string) => Promise<EndpointRecord>;
  getBySlug: (slug: string) => Promise<EndpointRecord>;
  create: (actor: AuthenticatedUser, input: CreateEndpointInput) => Promise<EndpointRecord>;
  update: (id: string, input: UpdateEndpointInput) => Promise<EndpointRecord>;
  remove: (id: string) => Promise<void>;
  listTools: (endpointId: string) => Promise<EndpointToolRecord[]>;
  upsertTool: (
    endpointId: string,
    toolId: string,
    input: UpsertEndpointToolInput,
  ) => Promise<EndpointToolRecord>;
  detachTool: (endpointId: string, toolId: string) => Promise<void>;
}

export interface EndpointsServiceDeps {
  endpointsRepo: EndpointsRepository;
  toolCache: Pick<ToolCache, "invalidateEndpointCatalog">;
  onCacheError?: (error: unknown, endpointId: string) => void;
}

export interface EndpointsRouterDeps {
  sessionResolver: SessionResolver;
  endpointsService: EndpointsService;
}
