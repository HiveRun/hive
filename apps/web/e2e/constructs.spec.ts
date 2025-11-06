import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { setTheme } from "./utils/theme";

const constructButton = 'button:has-text("New Construct")';

async function navigateToConstructs(page: Page) {
  await page.goto("/constructs");
  await page.waitForLoadState("networkidle");
  await page.waitForSelector(constructButton);
}

test.describe("Constructs Page", () => {
  test("should display constructs page correctly", async ({ page }) => {
    await navigateToConstructs(page);

    const pageTitle = page.locator('h1:has-text("Constructs")');
    const newButton = page.getByRole("button", { name: "New Construct" });

    const hasTitle = (await pageTitle.count()) > 0;
    const hasButton = (await newButton.count()) > 0;

    expect(hasTitle || hasButton).toBeTruthy();
  });

  test("should match constructs page snapshot (light mode)", async ({
    page,
  }) => {
    await setTheme(page, "light");
    await navigateToConstructs(page);
    await expect(page).toHaveScreenshot("constructs-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match constructs page snapshot (dark mode)", async ({
    page,
  }) => {
    await setTheme(page, "dark");
    await navigateToConstructs(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page).toHaveScreenshot("constructs-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match constructs page snapshot (mobile)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await navigateToConstructs(page);
    await expect(page).toHaveScreenshot("constructs-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
