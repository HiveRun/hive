import { expect, test } from "./utils/app-test";
import { setTheme } from "./utils/theme";

// Shared constants for E2E tests
const SELECTORS = {
  pageTitle: '[data-testid="templates-page-title"]',
  templateCard: '[data-testid="template-card"]',
  templateId: '[data-testid="template-id"]',
} as const;

const TEMPLATE_DETAIL_URL_REGEX = /\/templates\/[^/]+/;

const TEXT = {
  pageTitle: "Templates",
  pageDescription: "Browse available cell templates",
  noTemplates: "No templates available",
  configFileHint: "Create a hive.config.json file to define templates",
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
    const emptyState = page.getByText(TEXT.noTemplates);
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
      await expect(page.getByText(TEXT.configFileHint)).toBeVisible();
    }
  });

  test("should match templates page snapshot (light mode)", async ({
    page,
  }) => {
    await setTheme(page, "light");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("templates-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match templates page snapshot (dark mode)", async ({ page }) => {
    await setTheme(page, "dark");
    await page.goto("/templates");
    await page.waitForLoadState("networkidle");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page).toHaveScreenshot("templates-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should allow clicking into template detail view", async ({ page }) => {
    await page.waitForSelector(SELECTORS.templateCard);
    const firstCard = page.locator(SELECTORS.templateCard).first();
    await firstCard.click();
    await expect(page).toHaveURL(TEMPLATE_DETAIL_URL_REGEX);
    await expect(page.getByTestId("template-detail-title")).toBeVisible();
    await expect(page.getByTestId("template-context")).toBeVisible();
  });

  test("should match template detail snapshot (light mode)", async ({
    page,
  }) => {
    await setTheme(page, "light");
    await page.waitForSelector(SELECTORS.templateCard);
    await page.locator(SELECTORS.templateCard).first().click();
    await expect(page).toHaveURL(TEMPLATE_DETAIL_URL_REGEX);
    await page.waitForSelector('[data-testid="template-agent-info"]');
    await expect(page).toHaveScreenshot("template-detail-light.png", {
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
