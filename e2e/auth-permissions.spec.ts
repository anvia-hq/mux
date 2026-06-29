import { adminUser, expect, loginViaUi, regularUser, seedE2e, test } from "./fixtures";

test("regular users do not see admin-only navigation", async ({ page, request }) => {
  await seedE2e(request, {
    users: [
      { ...adminUser, role: "ADMIN" },
      { ...regularUser, role: "USER" },
    ],
  });

  await loginViaUi(page, regularUser);
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
