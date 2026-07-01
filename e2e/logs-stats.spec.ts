import {
  adminUser,
  expect,
  loginViaUi,
  regularUser,
  seedE2e,
  syntheticDeepSeekModelId,
  test,
} from "./fixtures";

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

test("paginates logs and updates the chart range", async ({ page, request }) => {
  const baseTime = new Date("2026-06-29T12:00:00.000Z").getTime();

  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    apiKeys: [{ name: "bulk-key", createdByEmail: adminUser.email, isActive: true }],
    requestLogs: Array.from({ length: 30 }, (_, index) => ({
      apiKeyName: "bulk-key",
      provider: index % 2 === 0 ? "synthetic" : "openai",
      model: index % 2 === 0 ? `synthetic:${syntheticDeepSeekModelId}` : "openai:gpt-4o",
      totalTokens: index + 1,
      estimatedCost: 0.001,
      latencyMs: 100 + index,
      statusCode: 200,
      createdAt: new Date(baseTime - index * 60_000).toISOString(),
    })),
  });
  await loginViaUi(page, adminUser);

  await page.goto("/logs");
  await expect(page.getByText(/Showing 1.+25 of 30/)).toBeVisible();
  await expect(page.getByText("bulk-key")).toHaveCount(25);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(/Showing 26.+30 of 30/)).toBeVisible();
  await expect(page.getByText("bulk-key")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByText(/Showing 1.+25 of 30/)).toBeVisible();

  await page.getByLabel("7 days").click();
  await expect(page.getByLabel("7 days")).toHaveAttribute("data-state", "on");
  await page.getByLabel("90 days").click();
  await expect(page.getByLabel("90 days")).toHaveAttribute("data-state", "on");
});

test("scopes request logs to the current user unless admin", async ({ page, request }) => {
  const now = new Date().toISOString();

  await seedE2e(request, {
    users: [
      { ...adminUser, role: "ADMIN" },
      { ...regularUser, role: "USER" },
    ],
    apiKeys: [
      { name: "admin-traffic-key", createdByEmail: adminUser.email, isActive: true },
      { name: "user-traffic-key", createdByEmail: regularUser.email, isActive: true },
    ],
    requestLogs: [
      {
        apiKeyName: "admin-traffic-key",
        provider: "openai",
        model: "openai:gpt-4o",
        totalTokens: 200,
        estimatedCost: 0.004,
        latencyMs: 220,
        statusCode: 200,
        createdAt: now,
      },
      {
        apiKeyName: "user-traffic-key",
        provider: "synthetic",
        model: `synthetic:${syntheticDeepSeekModelId}`,
        totalTokens: 100,
        estimatedCost: 0.001,
        latencyMs: 90,
        statusCode: 200,
        createdAt: now,
      },
    ],
  });

  await loginViaUi(page, regularUser);
  await page.goto("/logs");
  await expect(page.getByText("user-traffic-key")).toBeVisible();
  await expect(page.getByText("admin-traffic-key")).toHaveCount(0);
  await expect(page.getByText("100").first()).toBeVisible();

  await page.context().clearCookies();
  await loginViaUi(page, adminUser);
  await page.goto("/logs");
  await expect(page.getByText("user-traffic-key")).toBeVisible();
  await expect(page.getByText("admin-traffic-key")).toBeVisible();
  await expect(page.getByText("300").first()).toBeVisible();
});
