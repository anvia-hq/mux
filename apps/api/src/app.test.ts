import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { parseApiConfig } from "./config";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { extractBearerToken } from "./middleware/auth-guard";
import { createTestHarness } from "./testing/test-app";

describe("parseApiConfig", () => {
  test("rejects missing, whitespace-only secrets, and unsafe CORS origins", () => {
    expect(() => parseApiConfig({})).toThrow();
    expect(() =>
      parseApiConfig({
        MUX_MASTER_KEY: " ".repeat(32),
        BETTER_AUTH_SECRET: " ".repeat(32),
      }),
    ).toThrow();

    const badOrigins = [
      "*",
      "http://localhost:5173,*",
      "   ",
      ",,,",
      "http://localhost:5173/",
      "localhost:5173",
      "ftp://example.com",
    ];

    for (const origin of badOrigins) {
      expect(() =>
        parseApiConfig({
          MUX_MASTER_KEY: "a".repeat(32),
          BETTER_AUTH_SECRET: "b".repeat(32),
          CORS_ORIGIN: origin,
        }),
      ).toThrow();
    }

    const parsed = parseApiConfig({
      PORT: "4000",
      MUX_MASTER_KEY: "a".repeat(32),
      BETTER_AUTH_SECRET: "b".repeat(32),
      CORS_ORIGIN: "http://localhost:5173, https://mux.example.com",
    });

    expect(parsed.PORT).toBe(4000);
    expect(parsed.CORS_ORIGIN).toEqual(["http://localhost:5173", "https://mux.example.com"]);
  });
});

describe("Auth, RBAC, and error-handling boundaries", () => {
  test("rejects unauthenticated requests before schema validation and enforces admin vs member RBAC across all routes", async () => {
    const knownToolId = randomUUID();
    const harness = createTestHarness({ knownToolIds: [knownToolId] });
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
    expect(
      (
        await harness.request("/v1/endpoints", {
          method: "POST",
          body: {},
        })
      ).status,
    ).toBe(401);

    const authRouteRes = await harness.request("/api/auth/get-session");

    expect(authRouteRes.status).toBe(200);
    expect(harness.authPathsCalled).toEqual(["/api/auth/get-session"]);

    const epRes = await harness.request("/v1/endpoints", {
      method: "POST",
      userId: admin.id,
      body: { slug: "core-ep", name: "Core Endpoint" },
    });
    const ep = (await epRes.json()).endpoint;

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
    expect(
      (
        await harness.request(`/v1/endpoints/${ep.id}`, {
          method: "PATCH",
          userId: member.id,
          body: { name: "Hijacked" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await harness.request(`/v1/endpoints/${ep.id}`, {
          method: "DELETE",
          userId: member.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await harness.request(`/v1/endpoints/${ep.id}/tools/${knownToolId}`, {
          method: "PUT",
          userId: member.id,
          body: { enabled: true },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await harness.request(`/v1/endpoints/${ep.id}/tools/${knownToolId}`, {
          method: "DELETE",
          userId: member.id,
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

  test("maps malformed JSON to 400, unknown routes to 404, and sanitizes unexpected 500 errors", async () => {
    const harness = createTestHarness({ failEndpointsList: true });
    const admin = harness.seedUser({
      id: "admin-err",
      email: "admin@mux.dev",
      name: "Admin",
      role: "admin",
    });

    const malformedRes = await harness.request("/v1/endpoints", {
      method: "POST",
      userId: admin.id,
      rawBody: "{bad-json",
    });

    expect(malformedRes.status).toBe(400);
    expect((await malformedRes.json()).error.code).toBe("BAD_REQUEST");

    const notFoundRes = await harness.request("/v1/does-not-exist", { userId: admin.id });

    expect(notFoundRes.status).toBe(404);
    expect((await notFoundRes.json()).error.code).toBe("NOT_FOUND");

    const internalRes = await harness.request("/v1/endpoints", { userId: admin.id });

    expect(internalRes.status).toBe(500);

    const internalBody = await internalRes.text();

    expect(internalBody).not.toContain("secret-database-credentials-must-not-leak");
    expect(harness.unexpectedErrors.length).toBe(1);
  });
});

describe("Endpoints CRUD and catalog cache invalidation", () => {
  test("manages endpoints and tool bindings, rejects conflicts, lists tools, and invalidates catalog cache", async () => {
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

    const listToolsRes = await harness.request(`/v1/endpoints/${created.id}/tools`, {
      userId: member.id,
    });

    expect(listToolsRes.status).toBe(200);
    expect((await listToolsRes.json()).tools.length).toBe(1);

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
    expect(harness.backgroundErrors.length).toBe(1);
  });
});

describe("API keys scoping, ownership, throttling, and gateway authentication", () => {
  test("enforces role scoping, ownership, expiration, revocation, throttling, and fail-open touches", async () => {
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

    expect(
      (
        await harness.request("/v1/api-keys", {
          method: "POST",
          userId: member.id,
          body: { name: "Forbidden Global Key" },
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await harness.request("/v1/api-keys", {
          method: "POST",
          userId: admin.id,
          body: { name: "Expired", expiresAt: new Date(clock - 1000).toISOString() },
        })
      ).status,
    ).toBe(422);

    const adminGlobalRes = await harness.request("/v1/api-keys", {
      method: "POST",
      userId: admin.id,
      body: { name: "Admin Global" },
    });
    const adminGlobal = await adminGlobalRes.json();

    expect(adminGlobalRes.status).toBe(201);
    expect(adminGlobal.rawKey.startsWith("mux_live_")).toBe(true);
    expect("keyHash" in adminGlobal.apiKey).toBe(false);

    const memberScopedRes = await harness.request("/v1/api-keys", {
      method: "POST",
      userId: member.id,
      body: {
        name: "Member Ep A Key",
        endpointId: epA.id,
        expiresAt: "2026-12-31T23:59:59+07:00",
      },
    });
    const memberScoped = await memberScopedRes.json();

    expect(memberScopedRes.status).toBe(201);

    const memberList = (await (await harness.request("/v1/api-keys", { userId: member.id })).json())
      .apiKeys;
    const adminList = (await (await harness.request("/v1/api-keys", { userId: admin.id })).json())
      .apiKeys;

    expect(memberList.length).toBe(1);
    expect(adminList.length).toBe(2);

    expect(
      (
        await harness.request(`/v1/api-keys/${adminGlobal.apiKey.id}`, {
          method: "DELETE",
          userId: member.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await harness.request(`/v1/api-keys/${randomUUID()}`, {
          method: "DELETE",
          userId: admin.id,
        })
      ).status,
    ).toBe(404);

    await expect(harness.apiKeysService.authenticate("")).rejects.toThrow(UnauthorizedError);
    await expect(harness.apiKeysService.authenticate("mux_live_invalid")).rejects.toThrow(
      UnauthorizedError,
    );

    const authGlobal = await harness.apiKeysService.authenticate(adminGlobal.rawKey, epB.id);

    expect(authGlobal.id).toBe(adminGlobal.apiKey.id);
    expect(harness.getTouchLastUsedCalls()).toBe(1);

    await harness.apiKeysService.authenticate(adminGlobal.rawKey, epB.id);
    expect(harness.getTouchLastUsedCalls()).toBe(1);

    clock += 61_000;
    await harness.apiKeysService.authenticate(adminGlobal.rawKey, epB.id);
    expect(harness.getTouchLastUsedCalls()).toBe(2);

    const authScopedOk = await harness.apiKeysService.authenticate(memberScoped.rawKey, epA.id);

    expect(authScopedOk.id).toBe(memberScoped.apiKey.id);
    await expect(harness.apiKeysService.authenticate(memberScoped.rawKey, epB.id)).rejects.toThrow(
      ForbiddenError,
    );

    const memberSelfRevoke = await harness.request(`/v1/api-keys/${memberScoped.apiKey.id}`, {
      method: "DELETE",
      userId: member.id,
    });

    expect(memberSelfRevoke.status).toBe(200);
    await expect(harness.apiKeysService.authenticate(memberScoped.rawKey, epA.id)).rejects.toThrow(
      UnauthorizedError,
    );

    const secondMemberKeyRes = await harness.request("/v1/api-keys", {
      method: "POST",
      userId: member.id,
      body: {
        name: "Member Key 2",
        endpointId: epA.id,
        expiresAt: new Date(clock + 10_000).toISOString(),
      },
    });
    const secondMemberKey = await secondMemberKeyRes.json();

    clock += 11_000;
    await expect(
      harness.apiKeysService.authenticate(secondMemberKey.rawKey, epA.id),
    ).rejects.toThrow(UnauthorizedError);

    const adminRevokeMember = await harness.request(`/v1/api-keys/${secondMemberKey.apiKey.id}`, {
      method: "DELETE",
      userId: admin.id,
    });

    expect(adminRevokeMember.status).toBe(200);

    const failingTouchHarness = createTestHarness({ failTouchLastUsed: true });
    const touchAdmin = failingTouchHarness.seedUser({
      id: "admin-touch",
      email: "a@mux.dev",
      name: "Admin",
      role: "admin",
    });
    const createdKey = await failingTouchHarness.apiKeysService.create(touchAdmin, {
      name: "Resilient Key",
    });
    const authResilient = await failingTouchHarness.apiKeysService.authenticate(createdKey.rawKey);

    expect(authResilient.id).toBe(createdKey.apiKey.id);
    expect(failingTouchHarness.backgroundErrors.length).toBe(1);

    expect(extractBearerToken(new Headers({ authorization: `Bearer ${adminGlobal.rawKey}` }))).toBe(
      adminGlobal.rawKey,
    );
    expect(extractBearerToken(new Headers({ authorization: "Basic abc" }))).toBeNull();
  });
});
