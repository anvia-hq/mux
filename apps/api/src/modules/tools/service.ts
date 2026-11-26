import { NotFoundError } from "../../errors";
import type { ToolRecord, ToolsService, ToolsServiceDeps, UpdateToolInput } from "./types";

export const createToolsService = ({
  toolsRepo,
  toolCache,
  onCacheError,
}: ToolsServiceDeps): ToolsService => {
  const reportCacheError = (error: unknown, key: string): void => {
    if (!onCacheError) {
      return;
    }

    try {
      onCacheError(error, key);
    } catch {
      void error;
    }
  };

  return {
    list: async (sourceId?: string): Promise<ToolRecord[]> => toolsRepo.list(sourceId),

    getById: async (id: string): Promise<ToolRecord> => {
      const tool = await toolsRepo.findById(id);

      if (!tool) {
        throw new NotFoundError("Tool not found.");
      }

      return tool;
    },

    update: async (id: string, input: UpdateToolInput): Promise<ToolRecord> => {
      const updated = await toolsRepo.update(id, input);

      if (!updated) {
        throw new NotFoundError("Tool not found.");
      }

      try {
        await toolCache.invalidateTool(id);
      } catch (error) {
        reportCacheError(error, id);
      }

      const endpointIds = await toolsRepo.listEndpointIdsForTool(id);

      for (const endpointId of endpointIds) {
        try {
          await toolCache.invalidateEndpointCatalog(endpointId);
        } catch (error) {
          reportCacheError(error, endpointId);
        }
      }

      return updated;
    },

    invalidateToolCache: async (id: string): Promise<number> => {
      const tool = await toolsRepo.findById(id);

      if (!tool) {
        throw new NotFoundError("Tool not found.");
      }

      return toolCache.invalidateTool(id);
    },

    invalidateTagCache: async (tag: string): Promise<number> => toolCache.invalidateTag(tag),
  };
};
