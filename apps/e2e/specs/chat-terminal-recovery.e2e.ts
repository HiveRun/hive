import { expect, type Page, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCell as createChatCell,
  readTerminalOutputSeq as readOutputSeq,
  sendTerminalCommand as sendCommand,
  waitForChatRoute as waitForChat,
  waitForTerminalOutputAdvance as waitForOutput,
  ensureTerminalReady as waitForTerminal,
  waitForCondition as waitUntil,
} from "../src/test-helpers";

const TERMINAL_READY_TIMEOUT_MS = 120_000;
const CHAT_ROUTE_TIMEOUT_MS = 180_000;
const CONNECTION_TRANSITION_TIMEOUT_MS = 30_000;
const POST_RESTART_INPUT_TIMEOUT_MS = 30_000;
const PID_PATTERN = /pid\s+(\d+)/i;

test.describe("chat terminal recovery", () => {
  test("recovers from a terminated chat terminal process", async ({ page }) => {
    await page.goto("/");

    const cellId = await createChatCell({
      page,
      name: `E2E Chat Recovery ${Date.now()}`,
    });

    await page.goto(`/cells/${cellId}/chat`);
    await waitForChat({
      page,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });
    await waitForTerminal(page, {
      context: "chat terminal initial load",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const pid = await readTerminalPid(page);
    process.kill(pid, "SIGKILL");

    await waitUntil({
      timeoutMs: CONNECTION_TRANSITION_TIMEOUT_MS,
      errorMessage:
        "Chat terminal did not report exited/disconnected after kill",
      check: async () => {
        const state = await page
          .locator(selectors.terminalConnectionBadge)
          .getAttribute("data-connection-state");
        return state === "exited" || state === "disconnected";
      },
    });

    await page.locator(selectors.terminalRestartButton).click();
    await waitForTerminal(page, {
      context: "chat terminal after restart",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const beforePrompt = await readOutputSeq(page);
    await sendCommand(page, `E2E recovery token ${Date.now()}`);

    await waitForOutput(
      page,
      beforePrompt,
      POST_RESTART_INPUT_TIMEOUT_MS,
      "Chat terminal did not accept input after restart"
    );

    await expect(
      page.locator(selectors.terminalConnectionBadge)
    ).toHaveAttribute("data-connection-state", "online");
  });
});

async function readTerminalPid(page: Page): Promise<number> {
  const text = await page.locator(selectors.terminalRoot).innerText();
  const match = text.match(PID_PATTERN);
  if (!match?.[1]) {
    throw new Error("Failed to locate terminal pid in UI");
  }

  return Number(match[1]);
}
