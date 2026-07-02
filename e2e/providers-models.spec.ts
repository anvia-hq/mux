import {
  configureSyntheticProviderViaUi,
  createAndLoginAdmin,
  expect,
  providerSearchPlaceholder,
  removeSyntheticProviderViaUi,
  syntheticDeepSeekModelId,
  syntheticProviderKey,
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

test("filters providers, replaces a key, and persists a per-model toggle", async ({
  page,
  request,
}) => {
  await createAndLoginAdmin(page, request);
  await configureSyntheticProviderViaUi(page);

  await page.goto("/providers");
  await page.getByPlaceholder(providerSearchPlaceholder).fill("synthetic");
  await page.getByRole("button", { name: "Configured" }).click();
  let row = page.getByRole("row").filter({ hasText: "Synthetic" }).filter({ hasText: "synthetic" });
  await expect(row.getByText("Configured")).toBeVisible();

  await page.getByRole("button", { name: "Needs key" }).click();
  await expect(page.getByText("No providers match the current filters.")).toBeVisible();

  await page.getByRole("button", { name: "All" }).click();
  row = page.getByRole("row").filter({ hasText: "Synthetic" }).filter({ hasText: "synthetic" });
  await row.getByRole("button", { name: "Replace" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Replace Synthetic key")).toBeVisible();

  const replacementKey = `${syntheticProviderKey}-replacement`;
  await dialog.getByLabel("API key").fill(replacementKey);
  await dialog.getByRole("button", { name: "Replace key" }).click();
  await expect(row.getByText(`**** ${replacementKey.slice(-4)}`)).toBeVisible();

  await row.getByRole("link", { name: "Models" }).click();
  await expect(page.getByRole("heading", { name: "Synthetic models" })).toBeVisible();
  await page.getByPlaceholder("Search model, modality, capability...").fill("DeepSeek R1");

  let modelRow = page
    .getByRole("row")
    .filter({ has: page.getByText(syntheticDeepSeekModelId, { exact: true }) });
  let modelSwitch = modelRow.getByRole("switch");
  await expect(modelSwitch).toHaveAttribute("aria-checked", "true");
  await modelSwitch.click();
  await expect(modelSwitch).toHaveAttribute("aria-checked", "false");

  await page.reload();
  await page.getByPlaceholder("Search model, modality, capability...").fill("DeepSeek R1");
  modelRow = page
    .getByRole("row")
    .filter({ has: page.getByText(syntheticDeepSeekModelId, { exact: true }) });
  modelSwitch = modelRow.getByRole("switch");
  await expect(modelSwitch).toHaveAttribute("aria-checked", "false");

  await modelSwitch.click();
  await expect(modelSwitch).toHaveAttribute("aria-checked", "true");
});
