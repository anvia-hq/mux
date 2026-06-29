import {
  adminUser,
  configureSyntheticProviderViaUi,
  createAndLoginAdmin,
  e2eFailModel,
  expect,
  loginViaUi,
  seedE2e,
  syntheticDeepSeekModelId,
  test,
} from "./fixtures";

test("creates, exposes, edits, disables, and deletes a fallback group", async ({
  page,
  request,
}) => {
  await createAndLoginAdmin(page, request);
  await configureSyntheticProviderViaUi(page);

  await page.goto("/fallback-groups");
  await expect(page.getByRole("heading", { name: "Fallback groups" })).toBeVisible();
  await expect(page.getByText("No fallback groups")).toBeVisible();

  await page.getByRole("button", { name: "Create group" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Create fallback group")).toBeVisible();
  await dialog.getByLabel("Group ID").fill("fast-chat");
  await dialog.getByLabel("Name").fill("Fast chat");
  await dialog.getByLabel("Description").fill("Synthetic primary route for E2E.");
  await dialog.getByLabel("Provider").selectOption("synthetic");
  await dialog.getByLabel("Model").selectOption(syntheticDeepSeekModelId);
  await dialog.getByRole("button", { name: "Create group" }).click();

  let row = page.getByRole("row").filter({ hasText: "mux:fast-chat" });
  await expect(row.getByText("Fast chat")).toBeVisible();
  await expect(row.getByText(`1. synthetic:${syntheticDeepSeekModelId}`)).toBeVisible();
  await expect(row.getByText("On")).toBeVisible();

  await page.goto("/models");
  await page.getByPlaceholder("Search models or providers...").fill("mux:fast-chat");
  await expect(page.getByText("mux:fast-chat", { exact: true })).toBeVisible();
  await expect(page.getByText("Fallback group")).toBeVisible();

  await page.goto("/fallback-groups");
  row = page.getByRole("row").filter({ hasText: "mux:fast-chat" });
  await row.getByLabel("Edit Fast chat").click();
  await expect(dialog.getByText("Edit fallback group")).toBeVisible();
  await dialog.getByLabel("Name").fill("Fast chat backup");
  await dialog.getByRole("switch", { name: "Enabled" }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();

  row = page.getByRole("row").filter({ hasText: "mux:fast-chat" });
  await expect(row.getByText("Fast chat backup")).toBeVisible();
  await expect(row.getByText("Off")).toBeVisible();

  await page.goto("/models");
  await page.getByPlaceholder("Search models or providers...").fill("mux:fast-chat");
  await expect(page.getByText("mux:fast-chat", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No models match your search.")).toBeVisible();

  await page.goto("/fallback-groups");
  row = page.getByRole("row").filter({ hasText: "mux:fast-chat" });
  await row.getByLabel("Delete Fast chat backup").click();
  await expect(page.getByText("No fallback groups")).toBeVisible();
});

test("adds, removes, and reorders fallback targets before saving", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    syntheticProvider: true,
  });
  await loginViaUi(page, adminUser);

  await page.goto("/fallback-groups");
  await page.getByRole("button", { name: "Create group" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Create fallback group")).toBeVisible();

  await dialog.getByLabel("Group ID").fill("ordered-chain");
  await dialog.getByLabel("Name").fill("Ordered chain");

  const selects = dialog.locator("select");
  await selects.nth(0).selectOption("e2e");
  await selects.nth(1).selectOption("e2e-fail");

  await dialog.getByRole("button", { name: "Add" }).click();
  await selects.nth(2).selectOption("synthetic");
  await selects.nth(3).selectOption(syntheticDeepSeekModelId);

  await dialog.getByRole("button", { name: "Add" }).click();
  await dialog.getByLabel("Remove target").last().click();
  await dialog.getByLabel("Move target up").last().click();
  await dialog.getByRole("button", { name: "Create group" }).click();

  const row = page.getByRole("row").filter({ hasText: "mux:ordered-chain" });
  await expect(row.getByText("Ordered chain")).toBeVisible();
  await expect(row.getByText(`1. synthetic:${syntheticDeepSeekModelId}`)).toBeVisible();
  await expect(row.getByText(`2. ${e2eFailModel}`)).toBeVisible();
});
