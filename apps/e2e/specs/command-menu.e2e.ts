import { expect, type Page, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCellViaApi,
  requireApiUrl,
  waitForCellStatus,
} from "../src/test-helpers";

const CELL_READY_TIMEOUT_MS = 120_000;
const VISUAL_CELL_ID = "visual-command-cell";
const VISUAL_WORKSPACE_ID = "visual-workspace";
const VISUAL_CELL_NAME = "Visual Command Cell";

test.describe("command menu", () => {
  test("matches the default and searched visual states", async ({ page }) => {
    await installCommandMenuVisualFixtures(page);
    await forceDarkTheme(page);
    await page.goto("/");

    await openCommandMenu(page);
    await expect(page.locator(selectors.commandMenu)).toHaveScreenshot(
      "command-menu-default.png",
      {
        animations: "disabled",
        caret: "hide",
      }
    );

    await page.locator(selectors.commandMenuSearchInput).fill("shell visual");
    await expect(
      page.getByTestId(
        `command-menu-item-cell-page-${VISUAL_CELL_ID}-/cells/$cellId/terminal`
      )
    ).toBeVisible();
    await expect(page.locator(selectors.commandMenu)).toHaveScreenshot(
      "command-menu-search-results.png",
      {
        animations: "disabled",
        caret: "hide",
      }
    );
  });

  test("navigates to a cell page through keyboard search", async ({ page }) => {
    const apiUrl = requireApiUrl();
    const cellName = "E2E Command Menu Smoke";
    const cellId = await createCellViaApi({ apiUrl, name: cellName });
    await waitForCellStatus({
      apiUrl,
      cellId,
      status: "ready",
      timeoutMs: CELL_READY_TIMEOUT_MS,
    });

    await page.goto("/");
    await openCommandMenu(page);
    await page
      .locator(selectors.commandMenuSearchInput)
      .fill(`terminal ${cellName}`);

    const terminalCommand = page.getByTestId(
      `command-menu-item-cell-page-${cellId}-/cells/$cellId/terminal`
    );
    await expect(terminalCommand).toBeVisible();
    await expect(terminalCommand).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Enter");

    await page.waitForURL(
      (url) => url.pathname === `/cells/${cellId}/terminal`
    );
  });
});

async function openCommandMenu(page: Page) {
  await page.keyboard.press("Control+K");
  await expect(page.locator(selectors.commandMenu)).toBeVisible();
}

async function forceDarkTheme(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("vite-ui-theme", "dark");
  });
}

async function installCommandMenuVisualFixtures(page: Page) {
  const visualCell = {
    id: VISUAL_CELL_ID,
    name: VISUAL_CELL_NAME,
    description: "Stable command menu visual fixture.",
    status: "ready",
    workspaceId: VISUAL_WORKSPACE_ID,
    templateId: "visual-template",
    branchName: "visual-command-menu",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
  };

  await page.route("**/api/workspaces", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        activeWorkspaceId: VISUAL_WORKSPACE_ID,
        workspaces: [
          {
            id: VISUAL_WORKSPACE_ID,
            label: "Visual Workspace",
            path: "/tmp/visual-workspace",
            addedAt: "2026-05-20T00:00:00.000Z",
          },
        ],
      },
    });
  });

  await page.route("**/api/cells?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { cells: [visualCell] },
    });
  });

  await page.route("**/api/templates?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        templates: [
          {
            id: "visual-template",
            label: "Visual Template",
          },
        ],
      },
    });
  });

  await page.route("**/api/cells/**/services?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { services: [] },
    });
  });

  await page.route("**/api/agents/sessions/by-cell/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { session: null },
    });
  });
}
