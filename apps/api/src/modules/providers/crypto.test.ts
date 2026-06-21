import { afterEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, lastFour } from "./crypto";

const originalEncryptionKey = process.env.PROVIDER_KEYS_ENCRYPTION_KEY;

afterEach(() => {
  if (originalEncryptionKey === undefined) {
    delete process.env.PROVIDER_KEYS_ENCRYPTION_KEY;
  } else {
    process.env.PROVIDER_KEYS_ENCRYPTION_KEY = originalEncryptionKey;
  }
});

describe("provider key crypto", () => {
  it("encrypts and decrypts API keys with a passphrase key", () => {
    process.env.PROVIDER_KEYS_ENCRYPTION_KEY = "local-dev-secret";

    const encrypted = encrypt("sk-test-123");

    expect(encrypted).not.toBe("sk-test-123");
    expect(decrypt(encrypted)).toBe("sk-test-123");
  });

  it("encrypts and decrypts API keys with a 64-character hex key", () => {
    process.env.PROVIDER_KEYS_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    expect(decrypt(encrypt("hex-key-secret"))).toBe("hex-key-secret");
  });

  it("requires an encryption key and rejects short ciphertext", () => {
    delete process.env.PROVIDER_KEYS_ENCRYPTION_KEY;
    expect(() => encrypt("secret")).toThrow("PROVIDER_KEYS_ENCRYPTION_KEY is not set");

    process.env.PROVIDER_KEYS_ENCRYPTION_KEY = "local-dev-secret";
    expect(() => decrypt(Buffer.from("too-short").toString("base64"))).toThrow(
      "ciphertext is too short",
    );
  });

  it("returns the last four key characters for display", () => {
    expect(lastFour("sk-123456")).toBe("3456");
    expect(lastFour("abc")).toBe("abc");
  });
});
