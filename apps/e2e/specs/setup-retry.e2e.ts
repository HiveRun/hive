import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createCell,
  fileExists,
  waitForActivityTypes,
  waitForCellStatus,
} from "../src/test-helpers";

const SETUP_RETRY_TEMPLATE_LABEL = "E2E Setup Retry Template";
const INITIAL_READY_TIMEOUT_MS = 300_000;
const RETRY_STATE_TIMEOUT_MS = 180_000;
const SETUP_RETRY_TIMEOUT_BUFFER_MS = 60_000;
const SETUP_RETRY_TEST_TIMEOUT_MS =
  INITIAL_READY_TIMEOUT_MS +
  RETRY_STATE_TIMEOUT_MS * 2 +
  SETUP_RETRY_TIMEOUT_BUFFER_MS;

test.describe("setup retry", () => {
  test("recovers a failed setup after retry", async ({ page }) => {
    test.setTimeout(SETUP_RETRY_TEST_TIMEOUT_MS);

    const apiUrl = process.env.HIVE_E2E_API_URL;
    const workspacePath = process.env.HIVE_E2E_WORKSPACE_PATH;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }
    if (!workspacePath) {
      throw new Error("HIVE_E2E_WORKSPACE_PATH is required for E2E tests");
    }

    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `E2E Setup Retry ${Date.now()}`,
      templateLabel: SETUP_RETRY_TEMPLATE_LABEL,
    });

    const initialCell = await waitForCellStatus({
      apiUrl,
      cellId,
      status: "ready",
      timeoutMs: INITIAL_READY_TIMEOUT_MS,
    });
    expect(initialCell.lastSetupError ?? null).toBeNull();

    const markerPath = join(workspacePath, ".hive-setup-pass");
    await rm(markerPath, { force: true });
    expect(await fileExists(markerPath)).toBe(false);

    try {
      const firstRetryResponse = await retrySetup(apiUrl, cellId);
      expect(firstRetryResponse.ok).toBe(true);

      const failedCell = await waitForCellStatus({
        apiUrl,
        cellId,
        status: "error",
        timeoutMs: RETRY_STATE_TIMEOUT_MS,
      });
      expect(failedCell.lastSetupError).toContain("marker missing");

      await waitForActivityTypes({
        apiUrl,
        cellId,
        types: ["setup.retry"],
        timeoutMs: 30_000,
        errorMessage: "initial setup.retry activity event was not recorded",
      });

      await writeFile(markerPath, "ok\n", "utf8");
      expect(await fileExists(markerPath)).toBe(true);

      const secondRetryResponse = await retrySetup(apiUrl, cellId);
      expect(secondRetryResponse.ok).toBe(true);

      const recoveredCell = await waitForCellStatus({
        apiUrl,
        cellId,
        status: "ready",
        timeoutMs: RETRY_STATE_TIMEOUT_MS,
      });
      expect(recoveredCell.lastSetupError ?? null).toBeNull();

      await waitForActivityTypes({
        apiUrl,
        cellId,
        types: ["setup.retry"],
        timeoutMs: 30_000,
        errorMessage: "setup.retry activity event was not recorded",
      });
    } finally {
      await writeFile(markerPath, "ok\n", "utf8");
    }
  });
});

function retrySetup(apiUrl: string, cellId: string): Promise<Response> {
  return fetch(`${apiUrl}/api/cells/${cellId}/setup/retry`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
  });
}
