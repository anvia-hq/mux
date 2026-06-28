import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/modules/auth/password";

describe("password hashing", () => {
  it("hashes passwords with the expected scrypt format", async () => {
    const passwordHash = await hashPassword("correct horse battery staple");

    expect(passwordHash).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]+$/);
  });

  it("verifies matching passwords and rejects non-matches", async () => {
    const passwordHash = await hashPassword("secret-password");

    await expect(verifyPassword("secret-password", passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", passwordHash)).resolves.toBe(false);
  });

  it("rejects malformed password hashes", async () => {
    await expect(verifyPassword("secret-password", "not-a-valid-hash")).resolves.toBe(false);
    await expect(verifyPassword("secret-password", "bcrypt:salt:hash")).resolves.toBe(false);
  });
});
