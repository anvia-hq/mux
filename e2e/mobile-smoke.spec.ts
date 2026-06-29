import type { Page } from "@playwright/test";
import { adminUser, expect, loginViaUi, seedE2e, syntheticDeepSeekModelId, test } from "./fixtures";

test.use({
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

test("navigates core admin pages on a mobile viewport", async ({ page, request }) => {
  await seedE2e(request, {
    users: [{ ...adminUser, role: "ADMIN" }],
    syntheticProvider: true,
    fallbackGroups: [
      {
        id: "mobile-chat",
        name: "Mobile chat",
        targets: [{ provider: "synthetic", modelId: syntheticDeepSeekModelId }],
      },
    ],
  });
  await loginViaUi(page, adminUser);

  await goToMobileNav(page, "Models", "Available models");
  await expect(page.getByText(`synthetic:${syntheticDeepSeekModelId}`).first()).toBeVisible();

  await goToMobileNav(page, "Logs", "Request logs");
  await expect(page.getByText("No requests match the current filters.")).toBeVisible();

  await goToMobileNav(page, "Providers", "Providers");
  await page.getByPlaceholder("Search provider name or id...").fill("synthetic");
  await expect(page.getByRole("row").filter({ hasText: "Synthetic" })).toBeVisible();

  await goToMobileNav(page, "Fallbacks", "Fallback groups");
  await expect(page.getByText("mux:mobile-chat")).toBeVisible();

  await page.getByRole("button", { name: "Create group" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Create fallback group")).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(390);
});

async function goToMobileNav(page: Page, linkName: string, heading: string) {
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("link", { name: linkName }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: heading }).last()).toBeVisible();
}
