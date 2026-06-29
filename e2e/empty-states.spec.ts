import { createAndLoginAdmin, expect, test } from "./fixtures";

test("shows clean dashboard empty states", async ({ page, request }) => {
  await createAndLoginAdmin(page, request);

  await page.goto("/models");
  await expect(page.getByRole("heading", { name: "Available models" })).toBeVisible();
  await expect(page.getByText("No providers configured")).toBeVisible();
  await expect(
    page.getByText("Save a provider key from the Providers page to enable models."),
  ).toBeVisible();

  await page.goto("/logs");
  await expect(page.getByRole("heading", { name: "Request logs" })).toBeVisible();
  await expect(page.getByText("No requests match the current filters.")).toBeVisible();
  await expect(page.getByText("None")).toBeVisible();

  await page.goto("/fallback-groups");
  await expect(page.getByRole("heading", { name: "Fallback groups" })).toBeVisible();
  await expect(page.getByText("No fallback groups")).toBeVisible();
  await expect(
    page.getByText("Create a virtual model after configuring at least one provider model."),
  ).toBeVisible();
});
