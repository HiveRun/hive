import { expect, type Page, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCell,
  ensureTerminalReady,
  readTerminalOutputSeq,
  sendCellTerminalCommand,
  waitForTerminalOutputAdvance,
} from "../src/test-helpers";

const TERMINAL_READY_TIMEOUT_MS = 120_000;
const OUTPUT_TIMEOUT_MS = 30_000;

test.describe("terminal route", () => {
  test("opens terminal route, accepts input, and recovers after restart", async ({
    page,
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);

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

    const baseline = await readTerminalOutputSeq(page);
    const firstToken = `HIVE_TERMINAL_E2E_${Date.now()}`;

    await sendCellTerminalCommand(page, `echo ${firstToken}`);

    await waitForTerminalOutputAdvance(
      page,
      baseline,
      OUTPUT_TIMEOUT_MS,
      "Terminal did not process first command"
    );

    const afterFirstCommand = await readTerminalOutputSeq(page);
    const pasteToken = `HIVE_TERMINAL_PASTE_${Date.now()}`;

    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, `echo ${pasteToken}`);
    await page.locator(selectors.terminalInputTextarea).focus();
    await page.keyboard.press("Control+Shift+V");
    await page.keyboard.press("Enter");

    await waitForTerminalOutputAdvance(
      page,
      afterFirstCommand,
      OUTPUT_TIMEOUT_MS,
      "Terminal did not process pasted command"
    );

    await expect
      .poll(async () => readTerminalText(page), {
        message: "Terminal did not render pasted token",
      })
      .toContain(pasteToken);

    const afterPasteCommand = await readTerminalOutputSeq(page);

    await sendCellTerminalCommand(page, "pwd");
    await waitForTerminalOutputAdvance(
      page,
      afterPasteCommand,
      OUTPUT_TIMEOUT_MS,
      "Terminal did not process second command"
    );

    await page.locator(selectors.terminalRestartButton).click();
    await ensureTerminalReady(page, {
      context: "terminal route after restart",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const postRestartBaseline = await readTerminalOutputSeq(page);
    const secondToken = `HIVE_TERMINAL_RESTART_${Date.now()}`;
    await sendCellTerminalCommand(page, `echo ${secondToken}`);

    await waitForTerminalOutputAdvance(
      page,
      postRestartBaseline,
      OUTPUT_TIMEOUT_MS,
      "Terminal did not recover after restart"
    );
  });
});

async function readTerminalText(page: Page): Promise<string> {
  return (
    (await page.locator(selectors.terminalInputSurface).textContent()) ?? ""
  );
}
