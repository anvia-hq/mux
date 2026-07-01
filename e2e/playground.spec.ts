import {
  adminUser,
  e2eChatModel,
  expect,
  loginViaUi,
  seedE2e,
  test,
  waitForE2eRequestLog,
} from "./fixtures";

test("streams a playground prompt through chat completions", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    e2eProvider: true,
    apiKeys: [{ name: "playground-key", createdByEmail: adminUser.email, isActive: true }],
  });

  await loginViaUi(page, adminUser);
  await page.goto("/playground");

  await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "API key" })).toContainText("playground-key");
  await expect(page.getByRole("combobox", { name: "Model" })).toContainText(e2eChatModel);

  await page.getByLabel("Prompt").fill("hello playground");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("E2E stream for hello playground")).toBeVisible();

  await page.getByLabel("Prompt").fill("second turn");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("E2E stream for second turn")).toBeVisible();

  await waitForE2eRequestLog(
    request,
    (log) =>
      log.apiKeyName === "playground-key" &&
      log.model === e2eChatModel &&
      log.endpoint === "/v1/chat/completions" &&
      log.statusCode === 200,
  );
});
