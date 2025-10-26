import { expect, test } from "@playwright/test";

test.describe("Homepage - Visual Regression", () => {
  test("should match homepage snapshot (light mode)", async ({ page }) => {
    await page.goto("/");

    // Wait for page to be fully loaded
    await page.waitForLoadState("networkidle");

    // Take full page screenshot and compare with baseline
    await expect(page).toHaveScreenshot("homepage-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (dark mode)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Emulate dark color scheme
    await page.emulateMedia({ colorScheme: "dark" });

    await expect(page).toHaveScreenshot("homepage-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (mobile)", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match homepage snapshot (tablet)", async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-tablet.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});

test.describe("Homepage - Content", () => {
  test("should display the Better-T-Stack title", async ({ page }) => {
    await page.goto("/");

    // Check that the ASCII art title is visible
    const asciiArt = page.locator("pre.font-mono");
    await expect(asciiArt).toBeVisible();
    // Verify it contains box-drawing characters (actual ASCII art content)
    await expect(asciiArt).toContainText("██████");
  });

  test("should display API Status section", async ({ page }) => {
    await page.goto("/");

    // Check that the API Status section is visible
    await expect(
      page.getByRole("heading", { name: "API Status" })
    ).toBeVisible();
  });
});
