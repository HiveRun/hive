import { expect, test } from "./utils/app-test";

import { setTheme } from "./utils/theme";

test.describe("Homepage - Visual Snapshots", () => {
  test("should match homepage snapshot (light mode)", async ({ page }) => {
    await setTheme(page, "light");
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (dark mode)", async ({ page }) => {
    await setTheme(page, "dark");
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.emulateMedia({ colorScheme: "dark" });

    await expect(page).toHaveScreenshot("homepage-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (mobile)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await setTheme(page, "light");
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (tablet)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await setTheme(page, "light");
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-tablet.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
