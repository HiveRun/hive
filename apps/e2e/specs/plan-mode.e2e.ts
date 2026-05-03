import { type Page, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createApiCellAndOpenChat,
  fetchAgentSession,
  requireApiUrl,
  sendChatTerminalInput,
  wait,
  waitForCondition,
} from "../src/test-helpers";

const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_ROUTE_TIMEOUT_MS = 180_000;
const SESSION_MODE_TIMEOUT_MS = 120_000;
const PLAN_TO_BUILD_TEST_TIMEOUT_MS = 300_000;
const MODE_POLL_INTERVAL_MS = 500;
const CELL_TEMPLATE_LABEL = "E2E Template";
const TERMINAL_MODE_OPEN_CODE_PATTERN =
  /\b(Plan|Build)\b(?:\s*[·•])?\s+Big Pickle\s+OpenCode/gi;
const MODE_TOGGLE_INPUT = "\t";

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
    await sendTerminalModeInput(apiUrl, cellId, MODE_TOGGLE_INPUT);

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
      const content =
        (await options.page.locator(selectors.terminalRoot).textContent()) ??
        "";
      const normalized = content.replace(/\s+/g, " ");
      const matches = [...normalized.matchAll(TERMINAL_MODE_OPEN_CODE_PATTERN)];
      return matches.at(-1)?.[1] === options.expectedMode;
    },
  });
}

async function sendTerminalModeInput(
  apiUrl: string,
  cellId: string,
  data: string
): Promise<void> {
  const response = await sendChatTerminalInput(apiUrl, cellId, data);

  if (!response.ok) {
    throw new Error(`Failed to send chat terminal input: ${response.status}`);
  }
}
