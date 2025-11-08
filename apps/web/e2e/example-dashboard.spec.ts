import { expect, test } from "./utils/app-test";

import { setTheme } from "./utils/theme";

const STABILISATION_DELAY_MS = 500;
const DESKTOP_VIEWPORT = { width: 1280, height: 960 } as const;
const MOBILE_VIEWPORT = { width: 375, height: 667 } as const;

test.describe("Example Dashboard - Visual Snapshots", () => {
  test("should match example dashboard snapshot (light mode)", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await setTheme(page, "dark");
    await page.goto("/example-dashboard");
    await page.waitForLoadState("networkidle");
    await page.emulateMedia({ colorScheme: "dark" });

    await page.waitForTimeout(STABILISATION_DELAY_MS);

    await expect(page).toHaveScreenshot("example-dashboard-dark.png", {
      animations: "disabled",
    });
  });

  test("should match example dashboard snapshot (mobile)", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await setTheme(page, "light");
    await page.goto("/example-dashboard");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(STABILISATION_DELAY_MS);

    await expect(page).toHaveScreenshot("example-dashboard-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
