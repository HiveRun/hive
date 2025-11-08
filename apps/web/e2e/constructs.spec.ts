import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { setTheme } from "./utils/theme";

const constructButton = 'a:has-text("New Construct")';

const constructSnapshotFixture = [
  {
    id: "snapshot-construct",
    name: "Snapshot Construct",
    description: "Deterministic fixture used for visual regression tests.",
    templateId: "synthetic-dev",
    workspacePath: "/home/synthetic/.synthetic/constructs/snapshot-construct",
    createdAt: "2024-01-01T12:00:00.000Z",
  },
];

async function mockConstructsApi(page: Page) {
  await page.route("**/api/constructs", async (route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ constructs: constructSnapshotFixture }),
    });
  });
}

async function navigateToConstructs(page: Page) {
  await page.goto("/constructs");
  await page.waitForLoadState("networkidle");
  await page.waitForSelector(constructButton);
}

test.describe("Constructs Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockConstructsApi(page);
  });

  test("should display constructs page correctly", async ({ page }) => {
    // Listen for console errors
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("Console error:", msg.text());
      }
    });

    await navigateToConstructs(page);

    const pageTitle = page.locator('h1:has-text("Constructs")');
    const newButton = page.getByRole("button", { name: "New Construct" });

    const hasTitle = (await pageTitle.count()) > 0;
    const hasButton = (await newButton.count()) > 0;

    expect(hasTitle || hasButton).toBeTruthy();
  });

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

test.describe("Construct New Page", () => {
  async function navigateToConstructNew(page: Page) {
    await page.goto("/constructs/new");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("text=Create New Construct");
  }

  test("should match construct new page snapshot (light mode)", async ({
    page,
  }) => {
    await setTheme(page, "light");
    await navigateToConstructNew(page);
    await expect(page).toHaveScreenshot("construct-new-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match construct new page snapshot (dark mode)", async ({
    page,
  }) => {
    await setTheme(page, "dark");
    await navigateToConstructNew(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page).toHaveScreenshot("construct-new-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match construct new page snapshot (mobile)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await navigateToConstructNew(page);
    await expect(page).toHaveScreenshot("construct-new-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
