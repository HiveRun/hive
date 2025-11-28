import { expect, type Page, test } from "./utils/app-test";

import { cellSnapshotFixture, createCellFixture } from "./utils/cell-fixture";
import { mockAppApi } from "./utils/mock-api";
import { setTheme } from "./utils/theme";

const cellButton = 'a:has-text("New Cell")';
const DELETE_SELECTED_REGEX = /Delete Selected/;

async function navigateToCells(page: Page) {
  await page.goto("/cells");
  await page.waitForLoadState("networkidle");
  await page.waitForSelector(cellButton);
}

test.describe("Cells Page", () => {
  test("should display cells page correctly", async ({ page }) => {
    // Listen for console errors
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("Console error:", msg.text());
      }
    });

    await navigateToCells(page);

    const pageTitle = page.locator('h1:has-text("Cells")');
    const newButton = page.getByRole("button", { name: "New Cell" });

    const hasTitle = (await pageTitle.count()) > 0;
    const hasButton = (await newButton.count()) > 0;

    expect(hasTitle || hasButton).toBeTruthy();
  });

  test("cells route redirects to list", async ({ page }) => {
    await page.goto("/cells");
    await expect(page).toHaveURL("/cells/list");
  });

  test("cells list page loads", async ({ page }) => {
    await page.goto("/cells/list");
    await expect(page.locator('h1:has-text("Cells")')).toBeVisible();
  });

  test("shows bulk delete dialog when selecting cells", async ({ page }) => {
    await mockAppApi(page, {
      cells: [
        cellSnapshotFixture[0],
        createCellFixture({
          id: "secondary-cell",
          name: "Secondary Cell",
          workspacePath: "/home/hive/.hive/cells/secondary-cell",
          createdAt: "2024-02-01T10:00:00.000Z",
        }),
      ],
    });

    await navigateToCells(page);
    const deleteButton = page.getByTestId("delete-selected");
    const clearButton = page.getByTestId("clear-selection");
    const countBadge = page.getByTestId("delete-selected-count");
    await page.getByTestId("cell-select").first().click();
    await expect(deleteButton).toBeVisible();
    await expect(clearButton).toBeVisible();
    await expect(deleteButton).toHaveText(DELETE_SELECTED_REGEX);
    await expect(countBadge).toHaveText("1");
    await clearButton.click();
    await expect(deleteButton).toBeDisabled();
    await expect(countBadge).toHaveText("0");
    await page.getByTestId("cell-select").first().click();
    await page.getByTestId("cell-select").nth(1).click();
    await expect(deleteButton).toBeVisible();
    await expect(deleteButton).toHaveText(DELETE_SELECTED_REGEX);
    await expect(countBadge).toHaveText("2");
    await deleteButton.click();
    await expect(
      page.getByRole("heading", { name: "Delete 2 cells?" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(deleteButton).toBeVisible();
  });

  test("cells new page loads independently", async ({ page }) => {
    await page.goto("/cells/new");
    await expect(page.locator("text=Create New Cell")).toBeVisible();
  });

  test("cell form uses default template from config", async ({ page }) => {
    await mockAppApi(page);
    await page.goto("/cells/new");
    await page.waitForLoadState("networkidle");

    const templateSelect = page.getByTestId("template-select");
    await expect(templateSelect).toBeVisible();

    const selectValue = await templateSelect.locator("button").textContent();
    expect(selectValue).toBeTruthy();
    expect(selectValue).not.toBe("Select a template");
  });

  test("should match cells page snapshot (light mode)", async ({ page }) => {
    await setTheme(page, "light");
    await navigateToCells(page);
    await expect(page).toHaveScreenshot("cells-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match cells page snapshot (dark mode)", async ({ page }) => {
    await setTheme(page, "dark");
    await navigateToCells(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page).toHaveScreenshot("cells-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match cells page snapshot (mobile)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await navigateToCells(page);
    await expect(page).toHaveScreenshot("cells-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});

test.describe("Cell New Page", () => {
  async function navigateToCellNew(page: Page) {
    await page.goto("/cells/new");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("text=Create New Cell");
  }

  test("should match cell new page snapshot (light mode)", async ({ page }) => {
    await setTheme(page, "light");
    await navigateToCellNew(page);
    await expect(page).toHaveScreenshot("cell-new-light.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match cell new page snapshot (dark mode)", async ({ page }) => {
    await setTheme(page, "dark");
    await navigateToCellNew(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page).toHaveScreenshot("cell-new-dark.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("should match cell new page snapshot (mobile)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await navigateToCellNew(page);
    await expect(page).toHaveScreenshot("cell-new-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
