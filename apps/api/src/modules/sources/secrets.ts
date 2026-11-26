import type { SecretVault } from "@mux/core/types";
import { z } from "zod";
import { UnavailableError } from "../../errors";

const mcpSecretsSchema = z.object({
  headers: z.record(z.string(), z.string()),
});

const pluginSecretsSchema = z.object({
  env: z.record(z.string(), z.string()),
});

export const decryptMcpHeaders = (
  secretVault: SecretVault,
  encryptedSecrets: string | null,
): Record<string, string> | undefined => {
  if (!encryptedSecrets) {
    return undefined;
  }

  try {
    const decrypted = secretVault.decryptJson(encryptedSecrets, (value) =>
      mcpSecretsSchema.parse(value),
    );

    return decrypted.headers;
  } catch {
    throw new UnavailableError("Stored source credentials could not be decrypted.");
  }
};

export const decryptPluginSecrets = (
  secretVault: SecretVault,
  encryptedSecrets: string | null,
): Record<string, string> | undefined => {
  if (!encryptedSecrets) {
    return undefined;
  }

  try {
    const decrypted = secretVault.decryptJson(encryptedSecrets, (value) =>
      pluginSecretsSchema.parse(value),
    );

    return decrypted.env;
  } catch {
    throw new UnavailableError("Stored plugin secrets could not be decrypted.");
  }
};
