import type { AuthenticatedUser, SessionResolver } from "../../auth";
import type { EndpointsRepository } from "../endpoints/types";

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  endpointId: string | null;
  createdById: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  endpointId: string | null;
  createdById: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApiKeyInput {
  name: string;
  endpointId?: string | null;
  expiresAt?: string | null;
}

export interface InsertApiKeyData {
  name: string;
  keyPrefix: string;
  keyHash: string;
  endpointId: string | null;
  createdById: string;
  expiresAt: Date | null;
}

export interface CreatedApiKey {
  apiKey: PublicApiKey;
  rawKey: string;
}

export interface AuthenticatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  endpointId: string | null;
  createdById: string | null;
}

export interface ApiKeysRepository {
  listAll: () => Promise<ApiKeyRecord[]>;
  listByCreator: (userId: string) => Promise<ApiKeyRecord[]>;
  findById: (id: string) => Promise<ApiKeyRecord | null>;
  findByHash: (keyHash: string) => Promise<ApiKeyRecord | null>;
  insert: (data: InsertApiKeyData) => Promise<ApiKeyRecord>;
  revoke: (id: string, revokedAt: Date) => Promise<ApiKeyRecord | null>;
  touchLastUsed: (id: string, usedAt: Date) => Promise<void>;
}

export interface ApiKeysService {
  listForUser: (actor: AuthenticatedUser) => Promise<PublicApiKey[]>;
  create: (actor: AuthenticatedUser, input: CreateApiKeyInput) => Promise<CreatedApiKey>;
  revoke: (actor: AuthenticatedUser, id: string) => Promise<PublicApiKey>;
  authenticate: (rawKey: string, targetEndpointId?: string) => Promise<AuthenticatedApiKey>;
}

export interface ApiKeysServiceDeps {
  apiKeysRepo: ApiKeysRepository;
  endpointsRepo: Pick<EndpointsRepository, "findById">;
  now?: () => number;
}

export interface ApiKeysRouterDeps {
  sessionResolver: SessionResolver;
  apiKeysService: ApiKeysService;
}
