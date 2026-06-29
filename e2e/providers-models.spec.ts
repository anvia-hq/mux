import {
  configureSyntheticProviderViaUi,
  createAndLoginAdmin,
  expect,
  removeSyntheticProviderViaUi,
  syntheticDeepSeekModelId,
  test,
} from "./fixtures";

test("configures Synthetic, manages model exposure, and removes the key", async ({
  page,
  request,
}) => {
  await createAndLoginAdmin(page, request);
  await configureSyntheticProviderViaUi(page);

  await page.goto("/providers/synthetic/models");
  await expect(page.getByRole("heading", { name: "Synthetic models" })).toBeVisible();

  await page.getByPlaceholder("Search model, modality, capability...").fill("DeepSeek R1");
  await expect(page.getByText(syntheticDeepSeekModelId, { exact: true })).toBeVisible();

  await page.getByPlaceholder("Search model, modality, capability...").fill("");
  await page.getByRole("button", { name: "Disable all" }).click();
  await expect(page.getByText(/^0\/[1-9]\d*$/)).toBeVisible();

  await page.getByRole("button", { name: "Enable all" }).click();
  await expect(page.getByText(/^[1-9]\d*\/[1-9]\d*$/)).toBeVisible();
  await expect(page.getByText(/^0\/[1-9]\d*$/)).toHaveCount(0);

  await removeSyntheticProviderViaUi(page);
});
