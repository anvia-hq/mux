import { createAndLoginAdmin, expect, test } from "./fixtures";

test("creates, reveals, lists, and revokes an API key", async ({ page, request }) => {
  await createAndLoginAdmin(page, request);

  await page.goto("/api-keys");
  await expect(page.getByRole("heading", { name: "API keys" }).last()).toBeVisible();
  await expect(page.getByText("No API keys yet. Create one above.")).toBeVisible();

  await page.getByRole("button", { name: "New API key" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Create API key")).toBeVisible();
  await dialog.getByLabel("Name").fill("billing-service");
  await dialog.getByLabel("USD balance").fill("5");
  await dialog.getByRole("button", { name: "Create key" }).click();

  await expect(dialog.getByText("Save this key")).toBeVisible();
  const rawKeyLocator = dialog.locator("code");
  await expect(rawKeyLocator).toHaveText(/^mux_live_[a-f0-9]{64}$/);
  const rawKey = await rawKeyLocator.textContent();
  expect(rawKey).toBeTruthy();

  await dialog.getByRole("button", { name: "Done" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText(rawKey ?? "")).toHaveCount(0);

  const row = page.getByRole("row").filter({ hasText: "billing-service" });
  await expect(row.getByText("Active")).toBeVisible();
  await expect(row.getByText("$0.00 / $5.00")).toBeVisible();

  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row.getByText("Revoked")).toBeVisible();
  await expect(row.getByRole("button", { name: "Revoke" })).toBeDisabled();
});
