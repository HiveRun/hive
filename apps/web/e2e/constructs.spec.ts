import { expect, type Page, test } from "./utils/app-test";

import {
  constructSnapshotFixture,
  createConstructFixture,
} from "./utils/construct-fixture";
import { mockAppApi } from "./utils/mock-api";
import { setTheme } from "./utils/theme";

const constructButton = 'a:has-text("New Construct")';
const DELETE_SELECTED_REGEX = /Delete Selected/;

async function navigateToConstructs(page: Page) {
  await page.goto("/constructs");
  await page.waitForLoadState("networkidle");
  await page.waitForSelector(constructButton);
}

test.describe("Constructs Page", () => {
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

  test("shows bulk delete dialog when selecting constructs", async ({
    page,
  }) => {
    await mockAppApi(page, {
      constructs: [
        constructSnapshotFixture[0],
        createConstructFixture({
          id: "secondary-construct",
          name: "Secondary Construct",
          workspacePath:
            "/home/synthetic/.synthetic/constructs/secondary-construct",
          createdAt: "2024-02-01T10:00:00.000Z",
        }),
      ],
    });

    await navigateToConstructs(page);
    const deleteButton = page.getByTestId("delete-selected");
    const clearButton = page.getByTestId("clear-selection");
    const countBadge = page.getByTestId("delete-selected-count");
    await page.getByTestId("construct-select").first().click();
    await expect(deleteButton).toBeVisible();
    await expect(clearButton).toBeVisible();
    await expect(deleteButton).toHaveText(DELETE_SELECTED_REGEX);
    await expect(countBadge).toHaveText("1");
    await clearButton.click();
    await expect(deleteButton).toBeDisabled();
    await expect(countBadge).toHaveText("0");
    await page.getByTestId("construct-select").first().click();
    await page.getByTestId("construct-select").nth(1).click();
    await expect(deleteButton).toBeVisible();
    await expect(deleteButton).toHaveText(DELETE_SELECTED_REGEX);
    await expect(countBadge).toHaveText("2");
    await deleteButton.click();
    await expect(
      page.getByRole("heading", { name: "Delete 2 constructs?" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(deleteButton).toBeVisible();
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
