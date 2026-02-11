import { access, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createCell,
  fetchActivity,
  waitForCellStatus,
  waitForCondition,
} from "../src/test-helpers";

const SETUP_RETRY_TEMPLATE_LABEL = "E2E Setup Retry Template";

test.describe("setup retry", () => {
  test("recovers a failed setup after retry", async ({ page }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    const hiveHome = process.env.HIVE_E2E_HIVE_HOME;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }
    if (!hiveHome) {
      throw new Error("HIVE_E2E_HIVE_HOME is required for E2E tests");
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
      timeoutMs: 120_000,
    });
    expect(initialCell.lastSetupError ?? null).toBeNull();

    const markerPath = join(hiveHome, "cells", cellId, ".hive-setup-pass");
    await rm(markerPath, { force: true });
    expect(await fileExists(markerPath)).toBe(false);

    const firstRetryResponse = await retrySetup(apiUrl, cellId);
    expect(firstRetryResponse.ok).toBe(false);

    const failedCell = await waitForCellStatus({
      apiUrl,
      cellId,
      status: "error",
      timeoutMs: 120_000,
    });
    expect(failedCell.lastSetupError).toContain("marker missing");

    await writeFile(markerPath, "ok\n", "utf8");
    expect(await fileExists(markerPath)).toBe(true);

    const secondRetryResponse = await retrySetup(apiUrl, cellId);
    expect(secondRetryResponse.ok).toBe(true);

    const recoveredCell = await waitForCellStatus({
      apiUrl,
      cellId,
      status: "ready",
      timeoutMs: 120_000,
    });
    expect(recoveredCell.lastSetupError ?? null).toBeNull();

    await waitForCondition({
      timeoutMs: 30_000,
      errorMessage: "setup.retry activity event was not recorded",
      check: async () => {
        const events = await fetchActivity(apiUrl, cellId);
        return events.some((event) => event.type === "setup.retry");
      },
    });
  });
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function retrySetup(apiUrl: string, cellId: string): Promise<Response> {
  return fetch(`${apiUrl}/api/cells/${cellId}/setup/retry`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
  });
}
