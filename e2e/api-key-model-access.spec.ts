import {
  adminUser,
  apiRequest,
  bearerHeaders,
  e2eChatModel,
  expect,
  expectJsonStatus,
  loginViaUi,
  seedE2e,
  syntheticDeepSeekModelId,
  syntheticProviderKey,
  test,
} from "./fixtures";

test("keeps existing API keys pinned when a new provider is added", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
  });
  await loginViaUi(page, adminUser);

  const api = page.context().request;
  const snapshotKeyBody = await expectJsonStatus(
    await apiRequest(api, "POST", "/api-keys", { data: { name: "snapshot-client" } }),
    201,
  );
  const futureKeyBody = await expectJsonStatus(
    await apiRequest(api, "POST", "/api-keys", {
      data: { name: "future-client", includeFutureModels: true },
    }),
    201,
  );

  const snapshotKey = String(snapshotKeyBody.key);
  const futureKey = String(futureKeyBody.key);
  expect(snapshotKey).toMatch(/^mux_live_/);
  expect(futureKey).toMatch(/^mux_live_/);

  await expectJsonStatus(
    await apiRequest(api, "PUT", "/providers/synthetic", {
      data: { apiKey: syntheticProviderKey },
    }),
    200,
  );

  const addedModelId = `synthetic:${syntheticDeepSeekModelId}`;
  const snapshotModels = await listModelIds(request, snapshotKey);
  const futureModels = await listModelIds(request, futureKey);

  expect(snapshotModels).toContain(e2eChatModel);
  expect(snapshotModels).not.toContain(addedModelId);
  expect(futureModels).toContain(e2eChatModel);
  expect(futureModels).toContain(addedModelId);
});

async function listModelIds(request: Parameters<typeof apiRequest>[0], rawKey: string) {
  const response = await apiRequest(request, "GET", "/v1/models", {
    headers: bearerHeaders(rawKey),
  });
  const body = (await expectJsonStatus(response, 200)) as {
    data: Array<{ id: string }>;
  };
  return body.data.map((model) => model.id);
}
