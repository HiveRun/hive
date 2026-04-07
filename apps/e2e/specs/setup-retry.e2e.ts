import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createCell,
  fetchActivity,
  waitForCellStatus,
  waitForCondition,
  waitForProvisioningOrChatRoute,
} from "../src/test-helpers";

const SETUP_RETRY_TEMPLATE_LABEL = "E2E Setup Retry Template";
const RETRY_STATE_TIMEOUT_MS = 180_000;
const PROVISIONING_TIMELINE_TEXT = /Provisioning timeline/i;

test.describe("setup retry", () => {
  test("recovers a failed setup after retry", async ({ page }) => {
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
      name: `E2E Setup Retry ${Date.now()}`,
      templateLabel: SETUP_RETRY_TEMPLATE_LABEL,
    });

    const initialCell = await waitForCellStatus({
      apiUrl,
      cellId,
      status: "error",
      timeoutMs: RETRY_STATE_TIMEOUT_MS,
    });
    expect(initialCell.lastSetupError).toContain("marker missing");

    await page.goto(`/cells/${cellId}/setup`);
    await expect(
      page.getByTestId("setup-command-item").first()
    ).toHaveAttribute("data-state", "error");

    await page.goto(`/cells/${cellId}/provisioning`);

    const initialRoute = await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: RETRY_STATE_TIMEOUT_MS,
    });

    if (initialRoute === "provisioning") {
      await expect(page.getByText(PROVISIONING_TIMELINE_TEXT)).toBeVisible();
    }

    const markerPath = workspacePath
      ? join(workspacePath, ".hive-setup-pass")
      : join(hiveHome, "cells", cellId, ".hive-setup-pass");
    await writeFile(markerPath, "ok\n", "utf8");
    expect(await fileExists(markerPath)).toBe(true);

    await page.getByRole("button", { name: "Retry provisioning" }).click();

    const recoveredCell = await waitForCellStatus({
      apiUrl,
      cellId,
      status: "ready",
      timeoutMs: RETRY_STATE_TIMEOUT_MS,
    });
    expect(recoveredCell.lastSetupError ?? null).toBeNull();

    await page.goto(`/cells/${cellId}/setup`);
    await expect(
      page.getByTestId("setup-command-item").first()
    ).toHaveAttribute("data-state", "done");

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
