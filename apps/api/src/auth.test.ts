import { describe, expect, test } from "bun:test";
import { createUserCreationHooks } from "./auth";

describe("createUserCreationHooks", () => {
  test("forces member role before insert regardless of client input and elects a single bootstrap admin", async () => {
    const claimedBy: string[] = [];
    const hooks = createUserCreationHooks(async (userId) => {
      if (claimedBy.length > 0) {
        return false;
      }

      claimedBy.push(userId);

      return true;
    });

    const firstBefore = await hooks.before({
      id: "u1",
      email: "first@mux.dev",
      role: "admin",
    });
    const secondBefore = await hooks.before({
      id: "u2",
      email: "second@mux.dev",
      role: "admin",
    });

    expect(firstBefore.data.role).toBe("member");
    expect(secondBefore.data.role).toBe("member");

    await Promise.all([hooks.after({ id: "u1" }), hooks.after({ id: "u2" })]);

    expect(claimedBy).toEqual(["u1"]);
  });
});
