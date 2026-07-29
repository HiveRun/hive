import { type Page, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createApiCellAndOpenChat,
  ensureTerminalReady,
  fetchAgentSession,
  focusTerminalInput,
  requireApiUrl,
  wait,
  waitForCondition,
} from "../src/test-helpers";

const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_ROUTE_TIMEOUT_MS = 180_000;
const SESSION_MODE_TIMEOUT_MS = 120_000;
const PLAN_TO_BUILD_TEST_TIMEOUT_MS = 300_000;
const MODE_POLL_INTERVAL_MS = 500;
const TERMINAL_READY_TIMEOUT_MS = 120_000;
const TERMINAL_INPUT_FOCUS_TIMEOUT_MS = 10_000;
const CELL_TEMPLATE_LABEL = "E2E Template";
const TERMINAL_MODE_PATTERN = /\b(Plan|Build)\b\s*[·•]/gi;

test.describe("plan mode @plan-mode", () => {
  test("@plan-mode defaults new cells to plan mode", async ({ page }) => {
    await assertInitialMode({
      page,
      name: `Plan Mode Default ${Date.now()}`,
      mode: "plan",
    });
  });

  test("@plan-mode honors explicit build start mode", async ({ page }) => {
    await assertInitialMode({
      page,
      name: `Build Mode Override ${Date.now()}`,
      mode: "build",
      startMode: "build",
    });
  });

  test("@plan-mode transitions from plan to build during chat flow", async ({
    page,
  }) => {
    test.setTimeout(PLAN_TO_BUILD_TEST_TIMEOUT_MS);

    const apiUrl = requireApiUrl();
    const cellId = await createPlanModeCell({
      page,
      apiUrl,
      name: `Plan To Build ${Date.now()}`,
    });

    await waitForSessionMode({
      apiUrl,
      cellId,
      expectedStartMode: "plan",
      expectedCurrentMode: "plan",
    });

    await waitForTerminalMode({ page, expectedMode: "Plan" });
    await sendTerminalModeInput(page);
    await waitForTerminalMode({ page, expectedMode: "Build" });
  });
});

async function assertInitialMode(options: {
  page: Page;
  name: string;
  mode: "plan" | "build";
  startMode?: "plan" | "build";
}) {
  const apiUrl = requireApiUrl();
  const cellId = await createPlanModeCell({
    page: options.page,
    apiUrl,
    name: options.name,
    startMode: options.startMode,
  });

  await waitForSessionMode({
    apiUrl,
    cellId,
    expectedStartMode: options.mode,
    expectedCurrentMode: options.mode,
  });
  await waitForTerminalMode({
    page: options.page,
    expectedMode: options.mode === "plan" ? "Plan" : "Build",
  });
}

async function createPlanModeCell(options: {
  page: Page;
  apiUrl: string;
  name: string;
  startMode?: "plan" | "build";
}) {
  const result = await createApiCellAndOpenChat({
    page: options.page,
    apiUrl: options.apiUrl,
    name: options.name,
    templateLabel: CELL_TEMPLATE_LABEL,
    startMode: options.startMode,
    initialRouteTimeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    chatRouteTimeoutMs: CHAT_ROUTE_TIMEOUT_MS,
  });
  return result.cellId;
}

async function waitForSessionMode(options: {
  apiUrl: string;
  cellId: string;
  expectedStartMode: "plan" | "build";
  expectedCurrentMode: "plan" | "build";
  timeoutMs?: number;
  failOnTimeout?: boolean;
}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? SESSION_MODE_TIMEOUT_MS;

  const check = async () => {
    const session = await fetchAgentSession(options.apiUrl, options.cellId);
    return (
      session?.startMode === options.expectedStartMode &&
      session.currentMode === options.expectedCurrentMode
    );
  };

  if (options.failOnTimeout === false) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await check()) {
        return true;
      }
      await wait(MODE_POLL_INTERVAL_MS);
    }
    return false;
  }

  await waitForCondition({
    timeoutMs,
    errorMessage: `Session mode mismatch for cell ${options.cellId}`,
    check,
  });

  return true;
}

async function waitForTerminalMode(options: {
  page: Page;
  expectedMode: "Plan" | "Build";
}): Promise<void> {
  await waitForCondition({
    timeoutMs: SESSION_MODE_TIMEOUT_MS,
    errorMessage: `Terminal did not show ${options.expectedMode} mode`,
    check: async () => {
      const rows = await options.page
        .locator(`${selectors.terminalRoot} .xterm-rows > div`)
        .allTextContents();
      const matches = rows.flatMap((row) => [
        ...row.replace(/\s+/g, " ").matchAll(TERMINAL_MODE_PATTERN),
      ]);
      return matches.at(-1)?.[1] === options.expectedMode;
    },
  });
}

async function sendTerminalModeInput(page: Page): Promise<void> {
  await ensureTerminalReady(page, {
    context: "before mode toggle",
    timeoutMs: TERMINAL_READY_TIMEOUT_MS,
  });
  await focusTerminalInput(page, TERMINAL_INPUT_FOCUS_TIMEOUT_MS);
  await page.keyboard.press("Tab");
}
