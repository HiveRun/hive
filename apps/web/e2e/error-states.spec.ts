import { expect, test } from "@playwright/test";

const TRY_AGAIN_BUTTON = /try again/i;

test.describe("Error States - Visual Snapshots", () => {
  test("should match 404 not found page snapshot (light mode)", async ({
    page,
  }) => {
    await page.goto("/this-route-does-not-exist");
    await page.waitForLoadState("networkidle");

    // Verify the 404 component is shown
    await expect(page.getByText("Not Found")).toBeVisible();

    await expect(page).toHaveScreenshot("404-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match 404 not found page snapshot (dark mode)", async ({
    page,
  }) => {
    await page.goto("/this-route-does-not-exist");
    await page.waitForLoadState("networkidle");
    await page.emulateMedia({ colorScheme: "dark" });

    // Verify the 404 component is shown
    await expect(page.getByText("Not Found")).toBeVisible();

    await expect(page).toHaveScreenshot("404-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match route loader error page snapshot (light mode)", async ({
    page,
  }) => {
    await page.goto("/test-error");
    await page.waitForLoadState("networkidle");

    // Verify the error component is shown
    await expect(page.getByText("Something went wrong")).toBeVisible();
    await expect(
      page.getByText("This is a test error from the route loader")
    ).toBeVisible();

    await expect(page).toHaveScreenshot("error-loader-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match route loader error page snapshot (dark mode)", async ({
    page,
  }) => {
    await page.goto("/test-error");
    await page.waitForLoadState("networkidle");
    await page.emulateMedia({ colorScheme: "dark" });

    // Verify the error component is shown
    await expect(page.getByText("Something went wrong")).toBeVisible();
    await expect(
      page.getByText("This is a test error from the route loader")
    ).toBeVisible();

    await expect(page).toHaveScreenshot("error-loader-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match error page snapshot on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/test-error");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Something went wrong")).toBeVisible();

    await expect(page).toHaveScreenshot("error-loader-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("error page should have working reset button", async ({ page }) => {
    await page.goto("/test-error");
    await page.waitForLoadState("networkidle");

    // Verify reset button exists
    const resetButton = page.getByRole("button", { name: TRY_AGAIN_BUTTON });
    await expect(resetButton).toBeVisible();

    // Take snapshot with button visible
    await expect(page).toHaveScreenshot("error-with-reset-button.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
