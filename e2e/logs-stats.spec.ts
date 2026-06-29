import { adminUser, expect, loginViaUi, seedE2e, syntheticDeepSeekModelId, test } from "./fixtures";

test("shows seeded logs, filters them, and surfaces overview stats", async ({ page, request }) => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    apiKeys: [{ name: "traffic-key", createdByEmail: adminUser.email, isActive: true }],
    requestLogs: [
      {
        apiKeyName: "traffic-key",
        provider: "synthetic",
        model: `synthetic:${syntheticDeepSeekModelId}`,
        totalTokens: 300,
        estimatedCost: 0.003,
        latencyMs: 150,
        statusCode: 200,
        createdAt: now.toISOString(),
      },
      {
        apiKeyName: "traffic-key",
        provider: "openai",
        model: "openai:gpt-4o",
        totalTokens: 200,
        estimatedCost: 0.004,
        latencyMs: 220,
        statusCode: 200,
        createdAt: now.toISOString(),
      },
      {
        apiKeyName: "traffic-key",
        provider: "synthetic",
        model: `synthetic:${syntheticDeepSeekModelId}`,
        totalTokens: 100,
        estimatedCost: 0.001,
        latencyMs: 90,
        statusCode: 200,
        createdAt: yesterday.toISOString(),
      },
    ],
  });
  await loginViaUi(page, adminUser);

  await page.goto("/logs");
  await expect(page.getByRole("heading", { name: "Request logs" })).toBeVisible();
  await expect(page.getByText("traffic-key")).toHaveCount(3);
  await expect(page.getByRole("cell", { name: "synthetic", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "openai", exact: true })).toBeVisible();
  await expect(page.getByText("600").first()).toBeVisible();
  await expect(page.getByText("$0.0080").first()).toBeVisible();

  await page.getByPlaceholder("gpt-4o, claude-...").fill("openai:gpt-4o");
  await expect(page.getByText("openai:gpt-4o")).toBeVisible();
  await expect(page.getByText(`synthetic:${syntheticDeepSeekModelId}`)).toHaveCount(0);

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByText(`synthetic:${syntheticDeepSeekModelId}`).first()).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("By provider")).toBeVisible();
  await expect(page.getByText("Top models")).toBeVisible();
  await expect(page.getByText("synthetic", { exact: true })).toBeVisible();
  await expect(page.getByText("openai", { exact: true })).toBeVisible();
  await expect(page.getByText(/2 req .*400 tok .*\$0\.0040/)).toBeVisible();
  await expect(page.getByText(/1 req .*200 tok .*\$0\.0040/)).toBeVisible();
});
