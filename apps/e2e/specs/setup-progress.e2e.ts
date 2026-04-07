import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  createCell,
  waitForCellStatus,
  waitForCondition,
} from "../src/test-helpers";

const SETUP_PROGRESS_TEMPLATE_LABEL = "E2E Setup Progress Template";
const SETUP_TIMEOUT_MS = 180_000;
const SETUP_COMMAND_COUNT = 3;
const SETUP_RETRY_UI_REFRESH_DELAY_MS = 1000;

test.describe("setup progress", () => {
  test("updates command states progressively and resets cleanly on retry", async ({
    page,
  }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    const hiveHome = process.env.HIVE_E2E_HIVE_HOME;
    const workspacePath = process.env.HIVE_E2E_WORKSPACE_PATH;

    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    if (!hiveHome) {
      throw new Error("HIVE_E2E_HIVE_HOME is required for E2E tests");
    }

    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `E2E Setup Progress ${Date.now()}`,
      templateLabel: SETUP_PROGRESS_TEMPLATE_LABEL,
    });

    await page.goto(`/cells/${cellId}/setup`);
    await expect(page.getByTestId("setup-command-item")).toHaveCount(
      SETUP_COMMAND_COUNT
    );

    const failedCell = await waitForCellStatus({
      apiUrl,
      cellId,
      status: "error",
      timeoutMs: SETUP_TIMEOUT_MS,
    });

    expect(failedCell.lastSetupError).toContain("progress marker missing");
    await waitForSetupStates(page, ["done", "error", "pending"]);

    const markerPath = workspacePath
      ? join(workspacePath, ".hive-setup-progress-pass")
      : join(hiveHome, "cells", cellId, ".hive-setup-progress-pass");

    await writeFile(markerPath, "ok\n", "utf8");
    expect(await fileExists(markerPath)).toBe(true);

    await retryCellSetup(apiUrl, cellId);

    await page.goto(`/cells/${cellId}/setup`);
    await page.waitForTimeout(SETUP_RETRY_UI_REFRESH_DELAY_MS);

    const recoveredCell = await waitForCellStatus({
      apiUrl,
      cellId,
      status: "ready",
      timeoutMs: SETUP_TIMEOUT_MS,
    });

    expect(recoveredCell.lastSetupError ?? null).toBeNull();
    await waitForSetupStates(page, ["done", "done", "done"]);
  });
});

async function waitForSetupStates(page: Page, expected: string[]) {
  await waitForCondition({
    timeoutMs: 30_000,
    errorMessage: `setup command states did not become ${expected.join(",")}`,
    check: async () =>
      matchesSetupStates(await readSetupStates(page), expected),
  });
}

function readSetupStates(page: Page): Promise<string[]> {
  return page
    .getByTestId("setup-command-item")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-state") ?? "")
    );
}

function matchesSetupStates(values: string[], expected: string[]) {
  return (
    values.length === expected.length &&
    values.every((value, index) => value === expected[index])
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function retryCellSetup(apiUrl: string, cellId: string): Promise<void> {
  const response = await fetch(`${apiUrl}/rpc/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "retry_cell_setup",
      input: { cellId },
      fields: ["id", "status", "lastSetupError"],
    }),
  });

  if (!response.ok) {
    throw new Error(`retry_cell_setup failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { success?: boolean };
  if (payload.success === false) {
    throw new Error("retry_cell_setup returned unsuccessful response");
  }
}
