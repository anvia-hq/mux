import { adminUser, expect, loginViaUi, regularUser, seedE2e, test } from "./fixtures";

test("regular users do not see admin-only navigation", async ({ page, request }) => {
  const seed = await seedE2e(request, {
    users: [
      { ...adminUser, role: "ADMIN" },
      { ...regularUser, role: "USER" },
    ],
    apiKeys: [
      { name: "admin-owned-key", createdByEmail: adminUser.email },
      { name: "user-owned-key", createdByEmail: regularUser.email },
    ],
  });
  const userKey = seed.apiKeys.find((key) => key.name === "user-owned-key");
  if (!userKey) {
    throw new Error("seeded user-owned API key was not returned");
  }
  expect(userKey.rawKey).toMatch(/^mux_live_/);

  await loginViaUi(page, regularUser);
  await expect(page.getByRole("link", { name: "API keys" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Providers" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Fallbacks" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Logs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Models" })).toBeVisible();

  await page.goto("/api-keys");
  await page
    .context()
    .grantPermissions(["clipboard-write"], { origin: new URL(page.url()).origin });
  await expect(page.getByRole("heading", { name: "API keys" }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "New API key" })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "user-owned-key" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "admin-owned-key" })).toHaveCount(0);

  await page
    .getByRole("row")
    .filter({ hasText: "user-owned-key" })
    .getByRole("button", { name: "Copy" })
    .click();
  await expect(page.getByText("API key copied")).toBeVisible();
  const revealDialog = page.getByRole("dialog");
  await expect(revealDialog.getByText("Copy API key")).toBeVisible();
  await expect(revealDialog.locator("code")).toHaveText(userKey.rawKey);
});

test("admin-only routes remain available to admins", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
  });
  await loginViaUi(page, adminUser);

  await expect(page.getByRole("link", { name: "API keys" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Providers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fallbacks" })).toBeVisible();

  await page.goto("/api-keys");
  await expect(page.getByRole("heading", { name: "API keys" }).last()).toBeVisible();
});
