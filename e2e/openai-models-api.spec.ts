import {
  adminUser,
  expect,
  getOpenAiModels,
  seedE2e,
  syntheticDeepSeekModelId,
  test,
} from "./fixtures";

test("protects and returns OpenAI-compatible model listings", async ({ request }) => {
  const seed = await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    syntheticProvider: true,
    apiKeys: [
      { name: "active-client", createdByEmail: adminUser.email, isActive: true },
      { name: "revoked-client", createdByEmail: adminUser.email, isActive: false },
    ],
    fallbackGroups: [
      {
        id: "fast-chat",
        name: "Fast chat",
        targets: [{ provider: "synthetic", modelId: syntheticDeepSeekModelId }],
      },
    ],
  });
  const activeKey = seed.apiKeys.find((key) => key.name === "active-client")?.rawKey;
  const revokedKey = seed.apiKeys.find((key) => key.name === "revoked-client")?.rawKey;

  expect(activeKey).toBeTruthy();
  expect(revokedKey).toBeTruthy();

  await expect((await getOpenAiModels(request)).status()).toBe(401);
  await expect((await getOpenAiModels(request, "mux_live_invalid")).status()).toBe(401);
  await expect((await getOpenAiModels(request, revokedKey)).status()).toBe(401);

  const response = await getOpenAiModels(request, activeKey);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    object: "list";
    data: Array<{ id: string; object: "model"; owned_by: string }>;
  };
  const ids = body.data.map((model) => model.id);

  expect(body.object).toBe("list");
  expect(ids).toContain(`synthetic:${syntheticDeepSeekModelId}`);
  expect(ids).toContain("mux:fast-chat");
  expect(body.data.find((model) => model.id === "mux:fast-chat")?.owned_by).toBe("mux");
});
