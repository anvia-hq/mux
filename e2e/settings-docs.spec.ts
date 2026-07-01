import { adminUser, expect, loginViaUi, seedE2e, test } from "./fixtures";

test("shows account settings and signs out from the settings page", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
  });
  await loginViaUi(page, adminUser);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" }).last()).toBeVisible();
  await expect(page.locator("main").getByText(adminUser.email)).toBeVisible();
  await expect(page.locator("main").getByText(adminUser.name)).toBeVisible();
  await expect(page.locator("main").getByText("ADMIN", { exact: true })).toBeVisible();

  await page.locator("main").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Platform login")).toBeVisible();
});

test("renders documentation examples and switches code tabs", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
  });
  await loginViaUi(page, adminUser);

  await page.goto("/docs");
  await expect(page).toHaveURL(/\/docs\/services$/);
  await expect(
    page.getByRole("heading", {
      name: "API reference for routing LLM traffic through Mux Gateway",
    }),
  ).toBeVisible();
  await expect(page.getByText("OpenAI-compatible gateway")).toBeVisible();
  await expect(
    page.locator("code").filter({ hasText: /^http:\/\/127\.0\.0\.1:3010\/api\/v1$/ }),
  ).toBeVisible();

  const setup = page.locator("#setup");
  await setup.getByRole("tab", { name: "Python" }).click();
  await expect(setup.getByText("from openai import OpenAI")).toBeVisible();

  const listModels = page.locator("#list-models");
  await listModels.getByRole("tab", { name: "cURL" }).click();
  await expect(listModels.getByText("curl http://127.0.0.1:3010/api/v1/models")).toBeVisible();
});

test("renders coding harness docs and copy feedback", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
  });
  await loginViaUi(page, adminUser);

  await page.goto("/docs/coding-harness");
  await page
    .context()
    .grantPermissions(["clipboard-write"], { origin: new URL(page.url()).origin });
  await expect(
    page.getByRole("heading", { name: "Connect coding agents to Mux Gateway" }),
  ).toBeVisible();
  await expect(page.locator("#opencode").getByRole("heading", { name: "OpenCode" })).toBeVisible();
  await expect(page.locator("#pi-agent").getByRole("heading", { name: "Pi Agent" })).toBeVisible();
  await expect(
    page.locator("#claude-code").getByText("Anthropic-compatible Messages API"),
  ).toBeVisible();

  const prerequisites = page.locator("#prerequisites");
  await prerequisites.getByRole("button", { name: "Copy" }).click();
  await expect(prerequisites.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(page.getByText("Code copied")).toBeVisible();
});
