import { expect, test } from "@playwright/test";

test.describe("New Route Structure", () => {
  test("constructs route redirects to list", async ({ page }) => {
    await page.goto("/constructs");
    await expect(page).toHaveURL("/constructs/list");
  });

  test("constructs list page loads", async ({ page }) => {
    await page.goto("/constructs/list");
    await expect(page.locator('h1:has-text("Constructs")')).toBeVisible();
  });

  test("constructs new page loads independently", async ({ page }) => {
    await page.goto("/constructs/new");
    await expect(page.locator("text=Create New Construct")).toBeVisible();
  });
});
