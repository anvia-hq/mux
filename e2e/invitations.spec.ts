import { adminUser, expect, loginViaUi, seedE2e, test } from "./fixtures";

test("admin invites a user with a limited balance", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
  });

  await loginViaUi(page, adminUser);
  await page.goto("/users");
  await page
    .context()
    .grantPermissions(["clipboard-write"], { origin: new URL(page.url()).origin });

  await page.getByRole("button", { name: "New invite" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("USD balance").fill("5");
  await dialog.getByLabel("Max redemptions").fill("2");
  await dialog.getByRole("button", { name: "Create invite" }).click();
  await expect(dialog.getByText("Send this invite code")).toBeVisible();
  const inviteCode = (await dialog.locator("code").textContent()) ?? "";
  expect(inviteCode).toMatch(/^MUX-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await dialog.getByRole("button", { name: "Copy" }).click();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(page.getByText("Invite code copied")).toBeVisible();

  await page.context().clearCookies();
  await page.goto(`/register?code=${encodeURIComponent(inviteCode)}`);
  await expect(page.getByText("Create user account")).toBeVisible();
  await expect(page.getByLabel("Invitation code")).toHaveValue(inviteCode);
  await page.getByLabel("Name").fill("Invited User");
  await page.getByLabel("Email").fill("invitee@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Register" }).click();

  await expect(page.getByText("Save this API key")).toBeVisible();
  const rawApiKey = (await page.locator("code").textContent()) ?? "";
  expect(rawApiKey).toMatch(/^mux_live_/);
  await expect(page.getByText("Balance: $5.00")).toBeVisible();
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(page.getByText("API key copied")).toBeVisible();

  await page.context().clearCookies();
  await page.goto(`/register?code=${encodeURIComponent(inviteCode)}`);
  await page.getByLabel("Name").fill("Second User");
  await page.getByLabel("Email").fill("second@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByText("Save this API key")).toBeVisible();
  await expect(page.getByText("Balance: $5.00")).toBeVisible();

  await page.context().clearCookies();
  await page.goto(`/register?code=${encodeURIComponent(inviteCode)}`);
  await page.getByLabel("Name").fill("Third User");
  await page.getByLabel("Email").fill("third@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByText("invalid invitation code")).toBeVisible();

  await loginViaUi(page, adminUser);
  await page.goto("/api-keys");
  const row = page.getByRole("row").filter({ hasText: "invitee@example.com invite key" });
  await expect(row.getByText("$0.00 / $5.00")).toBeVisible();
  await expect(row.getByRole("cell", { name: "invitee@example.com", exact: true })).toBeVisible();
  const secondRow = page.getByRole("row").filter({ hasText: "second@example.com invite key" });
  await expect(secondRow.getByText("$0.00 / $5.00")).toBeVisible();
  await expect(
    secondRow.getByRole("cell", { name: "second@example.com", exact: true }),
  ).toBeVisible();

  await page.goto("/users");
  const registrationSwitch = page.getByRole("switch", { name: "Enable invite-code registration" });
  await registrationSwitch.click();
  await expect(registrationSwitch).toHaveAttribute("aria-checked", "false");
  await page.context().clearCookies();
  await page.goto(`/register?code=${encodeURIComponent(inviteCode)}`);
  await expect(page.getByText("Registration is closed")).toBeVisible();
});
