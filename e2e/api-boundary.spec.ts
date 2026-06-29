import {
  adminUser,
  apiRequest,
  bearerHeaders,
  e2eChatModel,
  e2eResponsesModel,
  expect,
  expectJsonStatus,
  loginViaUi,
  regularUser,
  seedE2e,
  syntheticDeepSeekModelId,
  test,
} from "./fixtures";

test("protects dashboard API routes at the HTTP boundary", async ({ request }) => {
  const cases = [
    { path: "/api-keys", status: 403 },
    { path: "/providers", status: 403 },
    { path: "/fallback-groups", status: 403 },
    { path: "/users", status: 403 },
    { path: "/logs", status: 401 },
    { path: "/dashboard/models", status: 401 },
  ];

  for (const { path, status } of cases) {
    await expectJsonStatus(await apiRequest(request, "GET", path), status);
  }
});

test("keeps admin APIs forbidden to regular users while allowing read-only user surfaces", async ({
  page,
  request,
}) => {
  await seedE2e(request, {
    users: [
      { ...adminUser, role: "ADMIN" },
      { ...regularUser, role: "USER" },
    ],
  });
  await loginViaUi(page, regularUser);

  const api = page.context().request;
  for (const path of ["/api-keys", "/providers", "/fallback-groups", "/users"]) {
    await expectJsonStatus(await apiRequest(api, "GET", path), 403);
  }

  await expectJsonStatus(await apiRequest(api, "GET", "/logs"), 200);
  await expectJsonStatus(await apiRequest(api, "GET", "/dashboard/models"), 200);
});

test("rejects invalid fallback group writes through the real API", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    syntheticProvider: true,
  });
  await loginViaUi(page, adminUser);

  const api = page.context().request;
  const validGroup = {
    id: "validated-group",
    name: "Validated group",
    enabled: true,
    targets: [{ provider: "synthetic", modelId: syntheticDeepSeekModelId }],
  };

  await expectJsonStatus(
    await apiRequest(api, "POST", "/fallback-groups", { data: validGroup }),
    201,
  );

  const duplicateId = await expectJsonStatus(
    await apiRequest(api, "POST", "/fallback-groups", { data: validGroup }),
    409,
  );
  expect(duplicateId.error).toBe("fallback group already exists: validated-group");

  const duplicateTarget = await expectJsonStatus(
    await apiRequest(api, "POST", "/fallback-groups", {
      data: {
        ...validGroup,
        id: "duplicate-target",
        targets: [
          { provider: "synthetic", modelId: syntheticDeepSeekModelId },
          { provider: "synthetic", modelId: syntheticDeepSeekModelId },
        ],
      },
    }),
    400,
  );
  expect(String(duplicateTarget.error)).toContain("duplicate fallback target");

  const unknownTarget = await expectJsonStatus(
    await apiRequest(api, "POST", "/fallback-groups", {
      data: {
        ...validGroup,
        id: "unknown-target",
        targets: [{ provider: "synthetic", modelId: "missing-model" }],
      },
    }),
    400,
  );
  expect(String(unknownTarget.error)).toContain("unknown or unconfigured fallback target");
});

test("rejects revoked API keys across OpenAI-compatible gateway endpoints", async ({ request }) => {
  const seed = await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    apiKeys: [{ name: "revoked-gateway-key", createdByEmail: adminUser.email, isActive: false }],
  });
  const rawKey = seed.apiKeys[0]?.rawKey ?? "";
  expect(rawKey).not.toBe("");

  const headers = bearerHeaders(rawKey);
  await expectJsonStatus(await apiRequest(request, "GET", "/v1/models", { headers }), 401);
  await expectJsonStatus(
    await apiRequest(request, "POST", "/v1/chat/completions", {
      headers,
      data: {
        model: e2eChatModel,
        messages: [{ role: "user", content: "blocked chat" }],
      },
    }),
    401,
  );
  await expectJsonStatus(
    await apiRequest(request, "POST", "/v1/responses", {
      headers,
      data: {
        model: e2eResponsesModel,
        input: "blocked response",
      },
    }),
    401,
  );
});
