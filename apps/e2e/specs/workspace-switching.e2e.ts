import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCell,
  fetchCell,
  fetchWorkspaceCells,
  fetchWorkspaces,
  waitForCondition,
} from "../src/test-helpers";

const CELL_TEMPLATE_LABEL = "E2E Template";

test.describe("workspace switching", () => {
  test("registers a second workspace and keeps cells isolated", async ({
    page,
  }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    const primaryWorkspacePath = process.env.HIVE_E2E_WORKSPACE_PATH;
    const secondaryWorkspacePath = process.env.HIVE_E2E_SECOND_WORKSPACE_PATH;

    if (!(apiUrl && primaryWorkspacePath && secondaryWorkspacePath)) {
      throw new Error(
        "HIVE_E2E_API_URL, HIVE_E2E_WORKSPACE_PATH, and HIVE_E2E_SECOND_WORKSPACE_PATH are required"
      );
    }

    const primaryLabel = basename(primaryWorkspacePath);
    const secondaryLabel = basename(secondaryWorkspacePath);

    await page.goto("/");

    await page.locator(selectors.workspaceRegisterButton).first().click();
    await page.getByText("Register New Workspace").waitFor({
      state: "visible",
      timeout: 15_000,
    });

    await page.getByPlaceholder("Search").fill(secondaryLabel);
    await page
      .getByRole("button", {
        name: new RegExp(escapeRegex(secondaryLabel), "i"),
      })
      .first()
      .click();
    await page.getByRole("button", { name: "Register workspace" }).click();

    await waitForCondition({
      timeoutMs: 30_000,
      errorMessage: "Second workspace was not registered",
      check: async () => {
        const workspaces = await fetchWorkspaces(apiUrl);
        return workspaces.workspaces.some(
          (workspace) => workspace.label === secondaryLabel
        );
      },
    });

    await page.keyboard.press("Escape");

    const workspaces = await fetchWorkspaces(apiUrl);
    const primaryWorkspace = workspaces.workspaces.find(
      (workspace) => workspace.label === primaryLabel
    );
    const secondaryWorkspace = workspaces.workspaces.find(
      (workspace) => workspace.label === secondaryLabel
    );

    if (!(primaryWorkspace && secondaryWorkspace)) {
      throw new Error("Primary and secondary workspaces must both exist");
    }

    const primaryCellName = `E2E Workspace A ${Date.now()}`;
    const primaryCellId = await createCell({
      page,
      name: primaryCellName,
      workspaceId: primaryWorkspace.id,
      templateLabel: CELL_TEMPLATE_LABEL,
    });

    const secondaryCellName = `E2E Workspace B ${Date.now()}`;
    const secondaryCellId = await createCell({
      page,
      name: secondaryCellName,
      workspaceId: secondaryWorkspace.id,
      templateLabel: CELL_TEMPLATE_LABEL,
    });

    const primaryCell = await fetchCell(apiUrl, primaryCellId);
    const secondaryCell = await fetchCell(apiUrl, secondaryCellId);
    expect(primaryCell.workspaceId).toBe(primaryWorkspace.id);
    expect(secondaryCell.workspaceId).toBe(secondaryWorkspace.id);

    const primaryCells = await fetchWorkspaceCells(apiUrl, primaryWorkspace.id);
    const secondaryCells = await fetchWorkspaceCells(
      apiUrl,
      secondaryWorkspace.id
    );

    expect(primaryCells.some((cell) => cell.id === primaryCellId)).toBe(true);
    expect(primaryCells.some((cell) => cell.id === secondaryCellId)).toBe(
      false
    );
    expect(secondaryCells.some((cell) => cell.id === secondaryCellId)).toBe(
      true
    );
    expect(secondaryCells.some((cell) => cell.id === primaryCellId)).toBe(
      false
    );

    const primarySection = page.locator(
      `${selectors.workspaceSection}[data-workspace-id="${primaryWorkspace.id}"]`
    );
    const secondarySection = page.locator(
      `${selectors.workspaceSection}[data-workspace-id="${secondaryWorkspace.id}"]`
    );

    await expect(primarySection).toBeVisible();
    await expect(secondarySection).toBeVisible();

    await expect(primarySection.getByText(primaryCellName)).toBeVisible();
    await expect(secondarySection.getByText(secondaryCellName)).toBeVisible();

    await secondarySection
      .locator(selectors.workspaceCellLink)
      .filter({ hasText: secondaryCellName })
      .click();
    await expect(page).toHaveURL(new RegExp(`/cells/${secondaryCellId}/chat`));
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
