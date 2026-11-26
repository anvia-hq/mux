import { generateApiKey, hashApiKey, verifyApiKeyHash } from "@mux/core/crypto";
import type { AuthenticatedUser } from "../../auth";
import { ForbiddenError, NotFoundError, UnauthorizedError, UnprocessableError } from "../../errors";
import type {
  ApiKeyRecord,
  ApiKeysService,
  ApiKeysServiceDeps,
  AuthenticatedApiKey,
  CreateApiKeyInput,
  CreatedApiKey,
  PublicApiKey,
} from "./types";

const toPublicApiKey = (record: ApiKeyRecord): PublicApiKey => ({
  id: record.id,
  name: record.name,
  keyPrefix: record.keyPrefix,
  endpointId: record.endpointId,
  createdById: record.createdById,
  lastUsedAt: record.lastUsedAt,
  expiresAt: record.expiresAt,
  revokedAt: record.revokedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export const createApiKeysService = ({
  apiKeysRepo,
  endpointsRepo,
  now = Date.now,
}: ApiKeysServiceDeps): ApiKeysService => ({
  listForUser: async (actor: AuthenticatedUser): Promise<PublicApiKey[]> => {
    const rows =
      actor.role === "admin"
        ? await apiKeysRepo.listAll()
        : await apiKeysRepo.listByCreator(actor.id);

    return rows.map(toPublicApiKey);
  },

  create: async (actor: AuthenticatedUser, input: CreateApiKeyInput): Promise<CreatedApiKey> => {
    const endpointId = input.endpointId ?? null;

    if (endpointId === null && actor.role !== "admin") {
      throw new ForbiddenError("Only admins can create global API keys.");
    }

    if (endpointId !== null) {
      const endpoint = await endpointsRepo.findById(endpointId);

      if (!endpoint) {
        throw new NotFoundError("Endpoint not found.");
      }
    }

    let expiresAt: Date | null = null;

    if (input.expiresAt) {
      const parsed = new Date(input.expiresAt);

      if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= now()) {
        throw new UnprocessableError("API key expiration must be a valid future timestamp.");
      }

      expiresAt = parsed;
    }

    const generated = generateApiKey("mux_live");
    const inserted = await apiKeysRepo.insert({
      name: input.name,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      endpointId,
      createdById: actor.id,
      expiresAt,
    });

    return {
      apiKey: toPublicApiKey(inserted),
      rawKey: generated.rawKey,
    };
  },

  revoke: async (actor: AuthenticatedUser, id: string): Promise<PublicApiKey> => {
    const existing = await apiKeysRepo.findById(id);

    if (!existing) {
      throw new NotFoundError("API key not found.");
    }

    if (actor.role !== "admin" && existing.createdById !== actor.id) {
      throw new ForbiddenError("You can only revoke API keys you created.");
    }

    if (existing.revokedAt !== null) {
      return toPublicApiKey(existing);
    }

    const revoked = await apiKeysRepo.revoke(id, new Date(now()));

    if (!revoked) {
      throw new NotFoundError("API key not found.");
    }

    return toPublicApiKey(revoked);
  },

  authenticate: async (rawKey: string, targetEndpointId?: string): Promise<AuthenticatedApiKey> => {
    if (rawKey.trim().length === 0) {
      throw new UnauthorizedError("API key is required.");
    }

    const lookupHash = hashApiKey(rawKey);
    const record = await apiKeysRepo.findByHash(lookupHash);

    if (!record || !verifyApiKeyHash(rawKey, record.keyHash)) {
      throw new UnauthorizedError("Invalid API key.");
    }

    if (record.revokedAt !== null) {
      throw new UnauthorizedError("API key has been revoked.");
    }

    if (record.expiresAt !== null && record.expiresAt.getTime() <= now()) {
      throw new UnauthorizedError("API key has expired.");
    }

    if (
      targetEndpointId !== undefined &&
      record.endpointId !== null &&
      record.endpointId !== targetEndpointId
    ) {
      throw new ForbiddenError("API key is not authorized for this endpoint.");
    }

    try {
      await apiKeysRepo.touchLastUsed(record.id, new Date(now()));
    } catch {
      void record.id;
    }

    return {
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      endpointId: record.endpointId,
      createdById: record.createdById,
    };
  },
});
