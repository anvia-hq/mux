export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  endpointId: string | null;
  createdById: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyInput {
  name: string;
  endpointId?: string | null;
}

export interface CreatedApiKeyResponse {
  apiKey: ApiKeyItem;
  rawKey: string;
}
