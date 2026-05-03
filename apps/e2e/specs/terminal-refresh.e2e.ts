import { test } from "@playwright/test";
import {
  createCellFromHome as createHomeCell,
  readTerminalOutputSeq as readOutputSeq,
  sendCellTerminalCommand as sendCommand,
  waitForTerminalOutputAdvance as waitForOutput,
  ensureTerminalReady as waitForTerminal,
} from "../src/test-helpers";

const TERMINAL_READY_TIMEOUT_MS = 120_000;
const OUTPUT_TIMEOUT_MS = 30_000;

test.describe("terminal reconnect", () => {
  test("reconnects after page refresh and still accepts input", async ({
    page,
  }) => {
    const cellId = await createHomeCell({
      page,
      name: `E2E Terminal Refresh ${Date.now()}`,
    });

    await page.goto(`/cells/${cellId}/terminal`);
    await waitForTerminal(page, {
      context: "terminal before refresh",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const beforeRefresh = await readOutputSeq(page);
    await sendCommand(page, "echo before-refresh");

    await waitForOutput(
      page,
      beforeRefresh,
      OUTPUT_TIMEOUT_MS,
      "Terminal did not process input before refresh"
    );

    await page.reload();

    await waitForTerminal(page, {
      context: "terminal after refresh",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const afterRefresh = await readOutputSeq(page);
    await sendCommand(page, "echo after-refresh");

    await waitForOutput(
      page,
      afterRefresh,
      OUTPUT_TIMEOUT_MS,
      "Terminal did not process input after refresh"
    );
  });
});
