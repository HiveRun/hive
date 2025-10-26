import { expect, test } from "@playwright/test";

/**
 * Homepage Visual Snapshot Tests
 *
 * Testing Philosophy: UI correctness is validated ENTIRELY through visual snapshots.
 * No component unit tests or content assertions - we only compare pixel-by-pixel screenshots.
 *
 * When to update snapshots:
 * - After intentional UI changes (design, layout, content)
 * - Command: bun test:e2e:update-snapshots
 *
 * Coverage:
 * - Light/Dark themes
 * - Mobile (375x667), Tablet (768x1024), Desktop (1280x720)
 *
 * When tests fail:
 * - Check test-results/ for actual.png and diff.png
 * - Review visual changes before updating snapshots
 * - Commit updated snapshots with code changes
 */

test.describe("Homepage - Visual Snapshots", () => {
  test("should match homepage snapshot (light mode)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (dark mode)", async ({ page }) => {
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
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (tablet)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-tablet.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
