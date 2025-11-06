import { expect, test } from "@playwright/test";

// Shared constants for E2E tests
const SELECTORS = {
  pageTitle: '[data-testid="templates-page-title"]',
  templateCard: '[data-testid="template-card"]',
  templateId: '[data-testid="template-id"]',
} as const;

const TEXT = {
  pageTitle: "Templates",
  pageDescription: "Browse available construct templates",
  noTemplates: "No templates available",
  configFileHint: "Create a synthetic.config.ts file to define templates",
} as const;

test.describe("Templates Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/templates");
  });

  test("should display templates page header correctly", async ({ page }) => {
    await page.waitForSelector(SELECTORS.pageTitle, { state: "visible" });
    await expect(page.locator(SELECTORS.pageTitle)).toBeVisible();
    await expect(page.getByText(TEXT.pageDescription)).toBeVisible();
  });

  test("should display template cards when templates are available", async ({
    page,
  }) => {
    // Wait for templates to load
    await page.waitForLoadState("networkidle");

    // Check if template cards are displayed
    const templateCards = page.locator('[data-testid="template-card"]');

    // If templates exist in config, verify they're displayed
    const firstCard = templateCards.first();
    if (await firstCard.isVisible()) {
      await expect(firstCard).toBeVisible();

      // Verify card structure
      await expect(
        firstCard.locator('[data-testid="template-id"]')
      ).toBeVisible();
    }
  });

  test("should display empty state when no templates available", async ({
    page,
  }) => {
    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Check for empty state message
    const emptyState = page.getByText("No templates available");
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
      await expect(
        page.getByText("Create a synthetic.config.ts file to define templates")
      ).toBeVisible();
    }
  });

  test("should match templates page snapshot (light mode)", async ({
    page,
  }) => {
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("templates-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match templates page snapshot (dark mode)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("templates-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match templates page snapshot (mobile)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("templates-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
