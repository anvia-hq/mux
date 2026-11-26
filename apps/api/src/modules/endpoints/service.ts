import type { AuthenticatedUser } from "../../auth";
import { ConflictError, NotFoundError } from "../../errors";
import type {
  CreateEndpointInput,
  EndpointRecord,
  EndpointToolRecord,
  EndpointsService,
  EndpointsServiceDeps,
  UpdateEndpointInput,
  UpsertEndpointToolInput,
} from "./types";

export const createEndpointsService = ({
  endpointsRepo,
  toolCache,
  onCacheError,
}: EndpointsServiceDeps): EndpointsService => {
  const invalidateCatalog = async (endpointId: string): Promise<void> => {
    try {
      await toolCache.invalidateEndpointCatalog(endpointId);
    } catch (error) {
      if (onCacheError) {
        try {
          onCacheError(error, endpointId);
        } catch {
          void error;
        }
      }
    }
  };

  return {
    list: async (): Promise<EndpointRecord[]> => endpointsRepo.list(),

    getById: async (id: string): Promise<EndpointRecord> => {
      const endpoint = await endpointsRepo.findById(id);

      if (!endpoint) {
        throw new NotFoundError("Endpoint not found.");
      }

      return endpoint;
    },

    getBySlug: async (slug: string): Promise<EndpointRecord> => {
      const endpoint = await endpointsRepo.findBySlug(slug);

      if (!endpoint) {
        throw new NotFoundError("Endpoint not found.");
      }

      return endpoint;
    },

    create: async (
      actor: AuthenticatedUser,
      input: CreateEndpointInput,
    ): Promise<EndpointRecord> => {
      const existing = await endpointsRepo.findBySlug(input.slug);

      if (existing) {
        throw new ConflictError(`Endpoint slug '${input.slug}' already exists.`);
      }

      return endpointsRepo.insert({
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        mode: input.mode ?? "direct",
        enabled: input.enabled ?? true,
        createdById: actor.id,
      });
    },

    update: async (id: string, input: UpdateEndpointInput): Promise<EndpointRecord> => {
      const updated = await endpointsRepo.update(id, input);

      if (!updated) {
        throw new NotFoundError("Endpoint not found.");
      }

      await invalidateCatalog(id);

      return updated;
    },

    remove: async (id: string): Promise<void> => {
      const removed = await endpointsRepo.remove(id);

      if (!removed) {
        throw new NotFoundError("Endpoint not found.");
      }

      await invalidateCatalog(id);
    },

    listTools: async (endpointId: string): Promise<EndpointToolRecord[]> => {
      const endpoint = await endpointsRepo.findById(endpointId);

      if (!endpoint) {
        throw new NotFoundError("Endpoint not found.");
      }

      return endpointsRepo.listTools(endpointId);
    },

    upsertTool: async (
      endpointId: string,
      toolId: string,
      input: UpsertEndpointToolInput,
    ): Promise<EndpointToolRecord> => {
      const endpoint = await endpointsRepo.findById(endpointId);

      if (!endpoint) {
        throw new NotFoundError("Endpoint not found.");
      }

      const exists = await endpointsRepo.toolExists(toolId);

      if (!exists) {
        throw new NotFoundError("Tool not found.");
      }

      const binding = await endpointsRepo.upsertTool(endpointId, toolId, {
        enabled: input.enabled ?? true,
        cachePolicyOverride: input.cachePolicyOverride ?? null,
      });

      await invalidateCatalog(endpointId);

      return binding;
    },

    detachTool: async (endpointId: string, toolId: string): Promise<void> => {
      const endpoint = await endpointsRepo.findById(endpointId);

      if (!endpoint) {
        throw new NotFoundError("Endpoint not found.");
      }

      const removed = await endpointsRepo.removeTool(endpointId, toolId);

      if (!removed) {
        throw new NotFoundError("Tool is not attached to this endpoint.");
      }

      await invalidateCatalog(endpointId);
    },
  };
};
