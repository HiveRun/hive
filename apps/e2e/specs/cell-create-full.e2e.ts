import { expect, test } from "@playwright/test";
import { createCell, fetchCell, waitForChatRoute } from "../src/test-helpers";

const FULL_E2E_TEMPLATE_LABEL = "E2E Template";
const INITIAL_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_MS = 180_000;

test.describe("full cell creation", () => {
  test("creates a cell through the real managed OpenCode path with no fake transport", async ({
    page,
  }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `Full E2E Create ${Date.now()}`,
      templateLabel: FULL_E2E_TEMPLATE_LABEL,
      timeoutMs: INITIAL_TIMEOUT_MS,
    });

    const initialCell = await fetchCell(apiUrl, cellId);
    expect(initialCell.status).toBe("provisioning");

    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: READY_TIMEOUT_MS,
    });

    const finalCell = await fetchCell(apiUrl, cellId);
    expect(finalCell.status).toBe("ready");
  });
});
