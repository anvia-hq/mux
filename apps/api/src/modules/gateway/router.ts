import type { CanonicalTool } from "@mux/core/types";
import { handleMcpJsonRpcRequest } from "@mux/mcp/gateway";
import { Elysia } from "elysia";
import { z } from "zod";
import { DomainError, NotFoundError, UnauthorizedError } from "../../errors";
import { extractBearerToken } from "../../middleware/auth-guard";
import type { GatewayRouterDeps } from "./types";

const mcpSlugParamSchema = z.object({
  slug: z.string().min(1),
});

const restExecuteParamsSchema = z.object({
  slug: z.string().min(1),
  toolSlug: z.string().min(1),
});

const restExecuteBodySchema = z.object({
  arguments: z.record(z.string(), z.unknown()).default({}),
  bypassCache: z.boolean().default(false),
});

export const createGatewayRouter = ({
  apiKeysService,
  endpointsService,
  toolsRepo,
  toolCache,
  executionService,
}: GatewayRouterDeps) => {
  const resolveEndpointCatalog = async (endpointId: string): Promise<CanonicalTool[]> => {
    const cached = await toolCache.getEndpointCatalog(endpointId);

    if (cached !== null) {
      return cached;
    }

    const fresh = await toolsRepo.listCanonicalToolsForEndpoint(endpointId);

    await toolCache.setEndpointCatalog(endpointId, fresh);

    return fresh;
  };

  const authenticateGatewayRequest = async (headers: Headers, slug: string) => {
    const rawKey = extractBearerToken(headers);

    if (!rawKey) {
      throw new UnauthorizedError("Bearer API key is required.");
    }

    const endpoint = await endpointsService.getBySlug(slug);

    if (!endpoint.enabled) {
      throw new NotFoundError("Endpoint is disabled.");
    }

    const apiKey = await apiKeysService.authenticate(rawKey, endpoint.id);

    return { endpoint, apiKey };
  };

  return new Elysia()
    .post(
      "/mcp/:slug",
      async ({ request, params, body, set }) => {
        const { endpoint, apiKey } = await authenticateGatewayRequest(request.headers, params.slug);
        const tools = await resolveEndpointCatalog(endpoint.id);
        const toolMap = new Map<string, CanonicalTool>();

        for (const tool of tools) {
          toolMap.set(tool.slug, tool);
        }

        const outcome = await handleMcpJsonRpcRequest(body, {
          endpointSlug: endpoint.slug,
          mode: endpoint.mode,
          tools,
          executeTool: async ({ toolSlug, args, bypassCache }) => {
            const targetTool = toolMap.get(toolSlug);

            if (!targetTool) {
              return {
                result: {
                  content: [
                    {
                      type: "text",
                      text: `Tool '${toolSlug}' is not available on endpoint '${endpoint.slug}'.`,
                    },
                  ],
                  isError: true,
                },
                cacheStatus: "disabled",
                durationMs: 0,
              };
            }

            try {
              return await executionService.executeCanonical({
                tool: targetTool,
                args,
                bypassCache,
                endpointId: endpoint.id,
                apiKeyId: apiKey.id,
              });
            } catch (error) {
              if (error instanceof DomainError) {
                return {
                  result: {
                    content: [{ type: "text", text: error.message }],
                    isError: true,
                  },
                  cacheStatus: "disabled",
                  durationMs: 0,
                };
              }

              throw error;
            }
          },
        });

        set.status = outcome.status;

        if (outcome.body === null) {
          return "";
        }

        return outcome.body;
      },
      {
        params: mcpSlugParamSchema,
      },
    )
    .post(
      "/v1/gateway/:slug/execute/:toolSlug",
      async ({ request, params, body }) => {
        const { endpoint, apiKey } = await authenticateGatewayRequest(request.headers, params.slug);
        const tools = await resolveEndpointCatalog(endpoint.id);
        const targetTool = tools.find((tool) => tool.slug === params.toolSlug);

        if (!targetTool) {
          throw new NotFoundError(
            `Tool '${params.toolSlug}' is not enabled on endpoint '${endpoint.slug}'.`,
          );
        }

        return executionService.executeCanonical({
          tool: targetTool,
          args: body.arguments,
          bypassCache: body.bypassCache,
          endpointId: endpoint.id,
          apiKeyId: apiKey.id,
        });
      },
      {
        params: restExecuteParamsSchema,
        body: restExecuteBodySchema,
      },
    );
};
