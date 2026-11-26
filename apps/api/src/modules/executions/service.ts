import { validateAgainstJsonSchema } from "@mux/core/json-schema";
import type {
  CanonicalTool,
  ToolCacheStatus,
  ToolExecutionResult,
  ToolExecutionStatus,
} from "@mux/core/types";
import { z } from "zod";
import { NotFoundError, UnavailableError, UnprocessableError } from "../../errors";
import type {
  ExecuteCanonicalToolInput,
  ExecuteToolInput,
  ExecuteToolOutput,
  ListExecutionsFilter,
  McpExecutorDeps,
  ToolExecutionRecord,
  ToolExecutionService,
  ToolExecutionServiceDeps,
  ToolSourceExecutor,
} from "./types";

const SENSITIVE_KEY_PATTERN =
  /(?:token|secret|password|passwd|api[-_]?key|auth|authorization|cookie|credential|private)/i;
const MAX_SUMMARY_DEPTH = 4;
const MAX_SUMMARY_STRING_LENGTH = 256;

const mcpSecretsSchema = z.object({
  headers: z.record(z.string(), z.string()),
});

const sanitizeValue = (value: unknown, depth: number): unknown => {
  if (depth > MAX_SUMMARY_DEPTH) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    if (value.length > MAX_SUMMARY_STRING_LENGTH) {
      return `${value.slice(0, MAX_SUMMARY_STRING_LENGTH)}...`;
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = sanitizeValue(val, depth + 1);
      }
    }

    return out;
  }

  return value;
};

export const redactArgsForAudit = (args: Record<string, unknown>): Record<string, unknown> => {
  const sanitized = sanitizeValue(args, 0);

  if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }

  return {};
};

export const createMcpSourceExecutor = ({
  mcpClient,
  secretVault,
}: McpExecutorDeps): ToolSourceExecutor => ({
  execute: async ({ source, toolName, args }): Promise<ToolExecutionResult> => {
    if (source.config.kind !== "mcp_remote") {
      throw new UnprocessableError("Source is not configured as a remote MCP server.");
    }

    let headers: Record<string, string> | undefined;

    if (source.encryptedSecrets) {
      const decrypted = secretVault.decryptJson(source.encryptedSecrets, (val) =>
        mcpSecretsSchema.parse(val),
      );

      headers = decrypted.headers;
    }

    return mcpClient.callTool(
      {
        url: source.config.url,
        transport: source.config.transport,
        headers,
        timeoutMs: source.config.timeoutMs,
      },
      toolName,
      args,
    );
  },
});

export const createToolExecutionService = ({
  executionsRepo,
  sourcesRepo,
  toolsRepo,
  toolCache,
  executors,
  now = Date.now,
  onAuditError,
}: ToolExecutionServiceDeps): ToolExecutionService => {
  const recordAudit = async (input: {
    toolId: string | null;
    toolSlug: string;
    sourceId: string | null;
    endpointId: string | null;
    apiKeyId: string | null;
    userId: string | null;
    status: ToolExecutionStatus;
    cacheStatus: ToolCacheStatus;
    durationMs: number;
    args: Record<string, unknown>;
    errorMessage: string | null;
  }): Promise<void> => {
    try {
      await executionsRepo.insert({
        toolId: input.toolId,
        toolSlug: input.toolSlug,
        sourceId: input.sourceId,
        endpointId: input.endpointId,
        apiKeyId: input.apiKeyId,
        userId: input.userId,
        status: input.status,
        cacheStatus: input.cacheStatus,
        durationMs: input.durationMs,
        argsSummary: redactArgsForAudit(input.args),
        errorMessage: input.errorMessage,
      });
    } catch (error) {
      if (onAuditError) {
        try {
          onAuditError(error);
        } catch {
          void error;
        }
      }
    }
  };

  const executeCanonical = async (input: ExecuteCanonicalToolInput): Promise<ExecuteToolOutput> => {
    const startedMs = now();
    const { tool } = input;

    if (!tool.enabled) {
      throw new UnprocessableError(`Tool '${tool.slug}' is disabled.`);
    }

    const validation = validateAgainstJsonSchema(input.args, tool.inputSchema);

    if (!validation.valid) {
      throw new UnprocessableError(`Invalid tool arguments: ${validation.errors.join("; ")}`);
    }

    const source = await sourcesRepo.findById(tool.sourceId);

    if (!source) {
      throw new NotFoundError("Tool source not found.");
    }

    if (source.status !== "active") {
      throw new UnavailableError(`Tool source '${source.slug}' is currently ${source.status}.`);
    }

    const executor = executors[source.kind];

    if (!executor) {
      throw new UnavailableError(
        `No runtime executor configured for source kind '${source.kind}'.`,
      );
    }

    try {
      const cached = await toolCache.executeWithCache({
        toolId: tool.id,
        schemaHash: tool.schemaHash,
        args: input.args,
        policy: tool.cachePolicy,
        scopeKey: input.endpointId ?? "playground",
        bypass: input.bypassCache ?? false,
        execute: () =>
          executor.execute({
            source,
            toolName: tool.name,
            args: input.args,
          }),
      });
      const durationMs = Math.max(0, now() - startedMs);
      const status: ToolExecutionStatus = cached.result.isError ? "error" : "success";

      await recordAudit({
        toolId: tool.id,
        toolSlug: tool.slug,
        sourceId: source.id,
        endpointId: input.endpointId ?? null,
        apiKeyId: input.apiKeyId ?? null,
        userId: input.userId ?? null,
        status,
        cacheStatus: cached.cacheStatus,
        durationMs,
        args: input.args,
        errorMessage: cached.result.isError ? "Tool returned an error result." : null,
      });

      return {
        result: cached.result,
        cacheStatus: cached.cacheStatus,
        durationMs,
      };
    } catch (error) {
      const durationMs = Math.max(0, now() - startedMs);
      const message = error instanceof Error ? error.message : "Tool execution failed.";

      await recordAudit({
        toolId: tool.id,
        toolSlug: tool.slug,
        sourceId: source.id,
        endpointId: input.endpointId ?? null,
        apiKeyId: input.apiKeyId ?? null,
        userId: input.userId ?? null,
        status: "error",
        cacheStatus: tool.cachePolicy.mode === "off" ? "disabled" : "miss",
        durationMs,
        args: input.args,
        errorMessage: message,
      });

      throw new UnavailableError(`Execution of '${tool.slug}' failed: ${message}`);
    }
  };

  const executeByToolId = async (input: ExecuteToolInput): Promise<ExecuteToolOutput> => {
    const tool = await toolsRepo.findById(input.toolId);

    if (!tool) {
      throw new NotFoundError("Tool not found.");
    }

    const source = await sourcesRepo.findById(tool.sourceId);

    if (!source) {
      throw new NotFoundError("Tool source not found.");
    }

    const canonical: CanonicalTool = {
      id: tool.id,
      sourceId: tool.sourceId,
      sourceSlug: source.slug,
      sourceKind: source.kind,
      name: tool.name,
      slug: tool.slug,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      cachePolicy: input.cachePolicyOverride ?? tool.cachePolicy,
      schemaHash: tool.schemaHash,
      enabled: tool.enabled,
    };

    return executeCanonical({
      tool: canonical,
      args: input.args,
      bypassCache: input.bypassCache,
      endpointId: input.endpointId,
      apiKeyId: input.apiKeyId,
      userId: input.userId,
    });
  };

  return {
    executeByToolId,
    executeCanonical,
    listExecutions: async (filter: ListExecutionsFilter): Promise<ToolExecutionRecord[]> =>
      executionsRepo.list(filter),
  };
};
