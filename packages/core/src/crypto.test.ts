import { Buffer } from "node:buffer";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createSecretVault, generateApiKey, verifyApiKeyHash } from "./crypto";

const VALID_PASSPHRASE = "mux-test-master-key-with-more-than-32-chars";
const ALT_PASSPHRASE = "another-mux-test-master-key-with-more-than-32";
const VALID_HEX_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("createSecretVault", () => {
  test("rejects master keys shorter than 32 characters", () => {
    expect(() => createSecretVault("too-short")).toThrow();
    expect(() => createSecretVault("   short-with-spaces   ")).toThrow();
  });

  test("round-trips encrypted strings and typed JSON with unique IVs", () => {
    const vault = createSecretVault(VALID_HEX_KEY);
    const first = vault.encrypt("top-secret-token");
    const second = vault.encrypt("top-secret-token");

    expect(first).not.toBe(second);
    expect(first).not.toContain("top-secret-token");
    expect(vault.decrypt(first)).toBe("top-secret-token");
    expect(vault.decrypt(second)).toBe("top-secret-token");

    const secretsSchema = z.object({ headers: z.record(z.string(), z.string()) });
    const encryptedJson = vault.encryptJson({ headers: { Authorization: "Bearer xyz" } });
    const decrypted = vault.decryptJson(encryptedJson, (val) => secretsSchema.parse(val));

    expect(decrypted).toEqual({ headers: { Authorization: "Bearer xyz" } });
  });

  test("rejects tampered ciphertext, tampered auth tags, wrong keys, and invalid tokens", () => {
    const vault = createSecretVault(VALID_PASSPHRASE);
    const otherVault = createSecretVault(ALT_PASSPHRASE);
    const token = vault.encrypt("sensitive-value");
    const parts = token.split(".");
    const cipherBytes = Buffer.from(parts[3], "base64url");

    cipherBytes[0] = cipherBytes[0] ^ 0xff;

    const flippedCipher = `${parts[0]}.${parts[1]}.${parts[2]}.${cipherBytes.toString("base64url")}`;
    const trailingGarbageCipher = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}A`;
    const tamperedTag = `${parts[0]}.${parts[1]}.AAAAAAAAAAAAAAAAAAAAAA.${parts[3]}`;

    expect(() => otherVault.decrypt(token)).toThrow();
    expect(() => vault.decrypt(flippedCipher)).toThrow();
    expect(() => vault.decrypt(trailingGarbageCipher)).toThrow();
    expect(() => vault.decrypt(tamperedTag)).toThrow();
    expect(() => vault.decrypt("v2.abc.def.ghi")).toThrow();
    expect(() => vault.decrypt("not-a-valid-token")).toThrow();
  });
});

describe("API key generation and verification", () => {
  test("generates unique prefixed keys and verifies hashes in constant time", () => {
    const first = generateApiKey();
    const second = generateApiKey();

    expect(first.rawKey).not.toBe(second.rawKey);
    expect(first.rawKey.startsWith(first.keyPrefix)).toBe(true);
    expect(verifyApiKeyHash(first.rawKey, first.keyHash)).toBe(true);
    expect(verifyApiKeyHash(second.rawKey, first.keyHash)).toBe(false);
    expect(verifyApiKeyHash(first.rawKey, "short-invalid-hash")).toBe(false);
  });
});
