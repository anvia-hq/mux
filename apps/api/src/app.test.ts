import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { parseApiConfig } from "./config";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { extractBearerToken } from "./middleware/auth-guard";
import { createTestHarness } from "./testing/test-app";

describe("parseApiConfig", () => {
  test("rejects missing or weak secrets and accepts valid configuration", () => {
    expect(() => parseApiConfig({})).toThrow();
    expect(() =>
      parseApiConfig({
        MUX_MASTER_KEY: "short",
        BETTER_AUTH_SECRET: "short",
      }),
    ).toThrow();

    const parsed = parseApiConfig({
      PORT: "4000",
      MUX_MASTER_KEY: "a".repeat(32),
      BETTER_AUTH_SECRET: "b".repeat(32),
    });

    expect(parsed.PORT).toBe(4000);
    expect(parsed.CORS_ORIGIN).toBe("http://localhost:5173");
  });
});

describe("Auth and RBAC enforcement", () => {
  test("rejects unauthenticated requests and enforces admin vs member boundaries", async () => {
    const harness = createTestHarness();
    const admin = harness.seedUser({
      id: "user-admin",
      email: "admin@mux.dev",
      name: "Admin",
      role: "admin",
    });
    const member = harness.seedUser({
      id: "user-member",
      email: "member@mux.dev",
      name: "Member",
      role: "member",
    });

    expect((await harness.request("/v1/users/me")).status).toBe(401);
    expect((await harness.request("/v1/endpoints")).status).toBe(401);
    expect((await harness.request("/v1/api-keys")).status).toBe(401);

    const meRes = await harness.request("/v1/users/me", { userId: member.id });

    expect(meRes.status).toBe(200);
    expect((await meRes.json()).user.role).toBe("member");

    expect((await harness.request("/v1/users", { userId: member.id })).status).toBe(403);
    expect(
      (
        await harness.request(`/v1/users/${admin.id}/role`, {
          method: "PATCH",
          userId: member.id,
          body: { role: "member" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await harness.request("/v1/endpoints", {
          method: "POST",
          userId: member.id,
          body: { slug: "support", name: "Support" },
        })
      ).status,
    ).toBe(403);

    const lastAdminDemote = await harness.request(`/v1/users/${admin.id}/role`, {
      method: "PATCH",
      userId: admin.id,
      body: { role: "member" },
    });

    expect(lastAdminDemote.status).toBe(422);

    const promoteMember = await harness.request(`/v1/users/${member.id}/role`, {
      method: "PATCH",
      userId: admin.id,
      body: { role: "admin" },
    });

    expect(promoteMember.status).toBe(200);
    expect((await promoteMember.json()).user.role).toBe("admin");

    const demoteOriginalAdmin = await harness.request(`/v1/users/${admin.id}/role`, {
      method: "PATCH",
      userId: member.id,
      body: { role: "member" },
    });

    expect(demoteOriginalAdmin.status).toBe(200);
    expect((await demoteOriginalAdmin.json()).user.role).toBe("member");
  });
});

describe("Endpoints CRUD and catalog cache invalidation", () => {
  test("manages endpoints and tool bindings, rejects conflicts, and invalidates catalog cache", async () => {
    const knownToolId = randomUUID();
    const missingToolId = randomUUID();
    const harness = createTestHarness({ knownToolIds: [knownToolId] });
    const admin = harness.seedUser({
      id: "admin-1",
      email: "admin@mux.dev",
      name: "Admin",
      role: "admin",
    });
    const member = harness.seedUser({
      id: "member-1",
      email: "member@mux.dev",
      name: "Member",
      role: "member",
    });

    const invalidSlug = await harness.request("/v1/endpoints", {
      method: "POST",
      userId: admin.id,
      body: { slug: "bad__slug", name: "Bad" },
    });

    expect(invalidSlug.status).toBe(422);

    const createdRes = await harness.request("/v1/endpoints", {
      method: "POST",
      userId: admin.id,
      body: { slug: "support-agent", name: "Support Agent", mode: "router" },
    });

    expect(createdRes.status).toBe(201);

    const created = (await createdRes.json()).endpoint;

    expect(created.slug).toBe("support-agent");
    expect(created.mode).toBe("router");

    const duplicateRes = await harness.request("/v1/endpoints", {
      method: "POST",
      userId: admin.id,
      body: { slug: "support-agent", name: "Duplicate" },
    });

    expect(duplicateRes.status).toBe(409);

    const memberRead = await harness.request(`/v1/endpoints/${created.id}`, { userId: member.id });

    expect(memberRead.status).toBe(200);

    const missingToolAttach = await harness.request(
      `/v1/endpoints/${created.id}/tools/${missingToolId}`,
      {
        method: "PUT",
        userId: admin.id,
        body: { enabled: true },
      },
    );

    expect(missingToolAttach.status).toBe(404);

    const attachRes = await harness.request(`/v1/endpoints/${created.id}/tools/${knownToolId}`, {
      method: "PUT",
      userId: admin.id,
      body: {
        enabled: true,
        cachePolicyOverride: { mode: "ttl", ttlSeconds: 120 },
      },
    });

    expect(attachRes.status).toBe(200);
    expect((await attachRes.json()).endpointTool.cachePolicyOverride.ttlSeconds).toBe(120);

    const updateRes = await harness.request(`/v1/endpoints/${created.id}`, {
      method: "PATCH",
      userId: admin.id,
      body: { name: "Support v2" },
    });

    expect(updateRes.status).toBe(200);

    const detachRes = await harness.request(`/v1/endpoints/${created.id}/tools/${knownToolId}`, {
      method: "DELETE",
      userId: admin.id,
    });

    expect(detachRes.status).toBe(204);

    const deleteRes = await harness.request(`/v1/endpoints/${created.id}`, {
      method: "DELETE",
      userId: admin.id,
    });

    expect(deleteRes.status).toBe(204);
    expect(harness.invalidatedEndpoints).toEqual([created.id, created.id, created.id, created.id]);
  });

  test("fails open on Redis catalog invalidation errors after persisting endpoint changes", async () => {
    const harness = createTestHarness({ failCatalogInvalidation: true });
    const admin = harness.seedUser({
      id: "admin-1",
      email: "admin@mux.dev",
      name: "Admin",
      role: "admin",
    });

    const createdRes = await harness.request("/v1/endpoints", {
      method: "POST",
      userId: admin.id,
      body: { slug: "resilient", name: "Resilient" },
    });
    const created = (await createdRes.json()).endpoint;
    const updatedRes = await harness.request(`/v1/endpoints/${created.id}`, {
      method: "PATCH",
      userId: admin.id,
      body: { enabled: false },
    });

    expect(updatedRes.status).toBe(200);
    expect((await updatedRes.json()).endpoint.enabled).toBe(false);
  });
});

describe("API keys scoping, ownership, and gateway authentication", () => {
  test("enforces role scoping, ownership, expiration, revocation, and endpoint authorization", async () => {
    let clock = 1_700_000_000_000;
    const harness = createTestHarness({ now: () => clock });
    const admin = harness.seedUser({
      id: "admin-1",
      email: "admin@mux.dev",
      name: "Admin",
      role: "admin",
    });
    const member = harness.seedUser({
      id: "member-1",
      email: "member@mux.dev",
      name: "Member",
      role: "member",
    });

    const epARes = await harness.request("/v1/endpoints", {
      method: "POST",
      userId: admin.id,
      body: { slug: "ep-a", name: "Endpoint A" },
    });
    const epA = (await epARes.json()).endpoint;
    const epBRes = await harness.request("/v1/endpoints", {
      method: "POST",
      userId: admin.id,
      body: { slug: "ep-b", name: "Endpoint B" },
    });
    const epB = (await epBRes.json()).endpoint;

    const memberGlobalAttempt = await harness.request("/v1/api-keys", {
      method: "POST",
      userId: member.id,
      body: { name: "Forbidden Global Key" },
    });

    expect(memberGlobalAttempt.status).toBe(403);

    const pastExpiryAttempt = await harness.request("/v1/api-keys", {
      method: "POST",
      userId: admin.id,
      body: { name: "Expired", expiresAt: new Date(clock - 1000).toISOString() },
    });

    expect(pastExpiryAttempt.status).toBe(422);

    const adminGlobalRes = await harness.request("/v1/api-keys", {
      method: "POST",
      userId: admin.id,
      body: { name: "Admin Global" },
    });

    expect(adminGlobalRes.status).toBe(201);

    const adminGlobal = await adminGlobalRes.json();

    expect(adminGlobal.rawKey.startsWith("mux_live_")).toBe(true);
    expect("keyHash" in adminGlobal.apiKey).toBe(false);

    const memberScopedRes = await harness.request("/v1/api-keys", {
      method: "POST",
      userId: member.id,
      body: {
        name: "Member Ep A Key",
        endpointId: epA.id,
        expiresAt: new Date(clock + 60_000).toISOString(),
      },
    });

    expect(memberScopedRes.status).toBe(201);

    const memberScoped = await memberScopedRes.json();

    const memberListRes = await harness.request("/v1/api-keys", { userId: member.id });
    const memberList = (await memberListRes.json()).apiKeys;

    expect(memberList.length).toBe(1);
    expect(memberList[0].id).toBe(memberScoped.apiKey.id);

    const memberRevokeAdminKey = await harness.request(`/v1/api-keys/${adminGlobal.apiKey.id}`, {
      method: "DELETE",
      userId: member.id,
    });

    expect(memberRevokeAdminKey.status).toBe(403);

    const authGlobal = await harness.apiKeysService.authenticate(adminGlobal.rawKey, epB.id);

    expect(authGlobal.id).toBe(adminGlobal.apiKey.id);

    const authScopedOk = await harness.apiKeysService.authenticate(memberScoped.rawKey, epA.id);

    expect(authScopedOk.id).toBe(memberScoped.apiKey.id);

    await expect(harness.apiKeysService.authenticate(memberScoped.rawKey, epB.id)).rejects.toThrow(
      ForbiddenError,
    );

    clock += 61_000;

    await expect(harness.apiKeysService.authenticate(memberScoped.rawKey, epA.id)).rejects.toThrow(
      UnauthorizedError,
    );

    const revokeAdminRes = await harness.request(`/v1/api-keys/${adminGlobal.apiKey.id}`, {
      method: "DELETE",
      userId: admin.id,
    });

    expect(revokeAdminRes.status).toBe(200);

    await expect(harness.apiKeysService.authenticate(adminGlobal.rawKey, epA.id)).rejects.toThrow(
      UnauthorizedError,
    );

    expect(extractBearerToken(new Headers({ authorization: `Bearer ${adminGlobal.rawKey}` }))).toBe(
      adminGlobal.rawKey,
    );
    expect(extractBearerToken(new Headers({ authorization: "Basic abc" }))).toBeNull();
  });
});
