import { expect, type Page, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCell,
  ensureTerminalReady,
  sendTerminalCommand,
  waitForCondition,
} from "../src/test-helpers";

const TERMINAL_READY_TIMEOUT_MS = 120_000;
const OUTPUT_TIMEOUT_MS = 30_000;

test.describe("terminal reconnect", () => {
  test("reconnects after page refresh and still accepts input", async ({
    page,
  }) => {
    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `E2E Terminal Refresh ${Date.now()}`,
    });

    await page.goto(`/cells/${cellId}/terminal`);
    await ensureTerminalReady(page, {
      context: "terminal before refresh",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    await expect(
      page.locator(selectors.terminalConnectionBadge)
    ).toHaveAttribute("data-connection-state", "online");

    const beforeRefresh = await readOutputSeq(page);
    await sendTerminalCommand(page, "echo before-refresh");

    await waitForCondition({
      timeoutMs: OUTPUT_TIMEOUT_MS,
      errorMessage: "Terminal did not process input before refresh",
      check: async () => (await readOutputSeq(page)) > beforeRefresh,
    });

    await page.reload();

    await ensureTerminalReady(page, {
      context: "terminal after refresh",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });
    await expect(
      page.locator(selectors.terminalConnectionBadge)
    ).toHaveAttribute("data-connection-state", "online");

    const afterRefresh = await readOutputSeq(page);
    await sendTerminalCommand(page, "echo after-refresh");

    await waitForCondition({
      timeoutMs: OUTPUT_TIMEOUT_MS,
      errorMessage: "Terminal did not process input after refresh",
      check: async () => (await readOutputSeq(page)) > afterRefresh,
    });
  });
});

async function readOutputSeq(page: Page): Promise<number> {
  const outputSeqRaw = await page
    .locator(selectors.terminalRoot)
    .getAttribute("data-terminal-output-seq");

  return Number(outputSeqRaw ?? "0");
}
