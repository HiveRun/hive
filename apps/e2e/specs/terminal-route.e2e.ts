import { expect, type Page, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCell,
  ensureTerminalReady,
  sendTerminalCommand,
  waitForCondition,
} from "../src/test-helpers";

const TERMINAL_READY_TIMEOUT_MS = 120_000;

test.describe("terminal route", () => {
  test("opens terminal route, accepts input, and recovers after restart", async ({
    page,
  }) => {
    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `E2E Terminal ${Date.now()}`,
    });

    await page.goto(`/cells/${cellId}/terminal`);
    await expect(page).toHaveURL(new RegExp(`/cells/${cellId}/terminal$`));

    await ensureTerminalReady(page, {
      context: "terminal route initial load",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    await expect(
      page.locator(selectors.terminalConnectionBadge)
    ).toHaveAttribute("data-connection-state", "online");

    const baseline = await readTerminalMetrics(page);
    const firstToken = `HIVE_TERMINAL_E2E_${Date.now()}`;

    await sendTerminalCommand(page, `echo ${firstToken}`);

    await waitForCondition({
      timeoutMs: 30_000,
      errorMessage: "Terminal did not process first command",
      check: async () => {
        const metrics = await readTerminalMetrics(page);
        return metrics.outputSeq > baseline.outputSeq;
      },
    });

    await sendTerminalCommand(page, "pwd");
    await waitForCondition({
      timeoutMs: 30_000,
      errorMessage: "Terminal route did not expose cell workspace path",
      check: async () => {
        const terminalRegionText = await page
          .locator(selectors.terminalRoot)
          .innerText();
        return terminalRegionText.includes(`/cells/${cellId}`);
      },
    });

    await page.locator(selectors.terminalRestartButton).click();
    await ensureTerminalReady(page, {
      context: "terminal route after restart",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const postRestartBaseline = await readTerminalMetrics(page);
    const secondToken = `HIVE_TERMINAL_RESTART_${Date.now()}`;
    await sendTerminalCommand(page, `echo ${secondToken}`);

    await waitForCondition({
      timeoutMs: 30_000,
      errorMessage: "Terminal did not recover after restart",
      check: async () => {
        const metrics = await readTerminalMetrics(page);
        return metrics.outputSeq > postRestartBaseline.outputSeq;
      },
    });
  });
});

async function readTerminalMetrics(page: Page): Promise<{ outputSeq: number }> {
  const outputSeqRaw = await page
    .locator(selectors.terminalRoot)
    .getAttribute("data-terminal-output-seq");

  return {
    outputSeq: Number(outputSeqRaw ?? "0"),
  };
}
