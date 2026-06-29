import {
  adminUser,
  createAdminViaApi,
  expect,
  loginViaUi,
  onboardAdminViaUi,
  test,
} from "./fixtures";

test("onboards the first admin and opens the dashboard", async ({ page }) => {
  await onboardAdminViaUi(page);

  await expect(
    page.getByText("Centralized LLM API gateway with request logging and admin controls."),
  ).toBeVisible();
});

test("logs out and logs back in", async ({ page, request }) => {
  await createAdminViaApi(request);
  await loginViaUi(page);

  await page.getByLabel("Sign out").click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Platform login")).toBeVisible();

  await page.getByLabel("Email").fill(adminUser.email);
  await page.getByLabel("Password").fill(adminUser.password);
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByRole("heading", { name: `Welcome, ${adminUser.name}` })).toBeVisible();
});

test("redirects protected routes to login", async ({ page, request }) => {
  await createAdminViaApi(request);

  await page.goto("/api-keys");

  await expect(page).toHaveURL(/\/login\?redirect=.*api-keys/);
  await expect(page.getByText("Platform login")).toBeVisible();
});
