import { adminUser, expect, loginViaUi, regularUser, seedE2e, test } from "./fixtures";

test("registers a regular user and hides admin-only navigation", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
  });

  await page.goto("/register");
  await expect(page.getByText("Create user account")).toBeVisible();
  await page.getByLabel("Name").fill(regularUser.name);
  await page.getByLabel("Email").fill(regularUser.email);
  await page.getByLabel("Password").fill(regularUser.password);
  await page.getByRole("button", { name: "Register" }).click();

  await expect(page.getByRole("heading", { name: `Welcome, ${regularUser.name}` })).toBeVisible();
  await expect(page.getByRole("link", { name: "API keys" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Providers" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Fallbacks" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Logs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Models" })).toBeVisible();

  await page.goto("/api-keys");
  await expect(page.getByText("Admin only")).toBeVisible();
  await expect(page.getByText("API key management is restricted to administrators.")).toBeVisible();
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
