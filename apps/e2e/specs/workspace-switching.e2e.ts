import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createCellViaApi,
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

    await registerWorkspaceIfMissing({
      apiUrl,
      path: secondaryWorkspacePath,
      label: secondaryLabel,
    });

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

    await page.reload();

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
    const secondaryCellName = `E2E Workspace B ${Date.now()}`;

    const [primaryCellId, secondaryCellId] = await Promise.all([
      createCellViaApi({
        apiUrl,
        name: primaryCellName,
        workspaceId: primaryWorkspace.id,
        templateLabel: CELL_TEMPLATE_LABEL,
      }),
      createCellViaApi({
        apiUrl,
        name: secondaryCellName,
        workspaceId: secondaryWorkspace.id,
        templateLabel: CELL_TEMPLATE_LABEL,
      }),
    ]);

    await page.reload();

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

    await expect(
      page.getByRole("link", { name: primaryCellName }).first()
    ).toBeVisible();
    const secondaryCellLink = page
      .getByRole("link", { name: secondaryCellName })
      .first();
    await expect(secondaryCellLink).toBeVisible();

    await secondaryCellLink.click();
    await expect(page).toHaveURL(new RegExp(`/cells/${secondaryCellId}/chat`));
  });
});

async function registerWorkspaceIfMissing(options: {
  apiUrl: string;
  path: string;
  label: string;
}): Promise<void> {
  const existing = await fetchWorkspaces(options.apiUrl);
  const alreadyRegistered = existing.workspaces.some(
    (workspace) =>
      workspace.path === options.path || workspace.label === options.label
  );

  if (alreadyRegistered) {
    return;
  }

  const response = await fetch(`${options.apiUrl}/api/workspaces`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      path: options.path,
      label: options.label,
      activate: false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to register workspace ${options.label}: ${response.status}`
    );
  }
}
