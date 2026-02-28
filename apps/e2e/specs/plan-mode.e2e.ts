import { type Page, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCellViaApi,
  ensureTerminalReady,
  sendTerminalCommand,
  waitForChatRoute,
  waitForCondition,
  waitForProvisioningOrChatRoute,
} from "../src/test-helpers";

type AgentSession = {
  id: string;
  startMode?: "plan" | "build";
  currentMode?: "plan" | "build";
};

type AgentSessionResponse = {
  session: AgentSession | null;
};

type CellDetails = {
  id: string;
  workspacePath: string;
  opencodeSessionId: string | null;
  opencodeCommand: string | null;
};

const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_ROUTE_TIMEOUT_MS = 180_000;
const SESSION_MODE_TIMEOUT_MS = 120_000;
const UI_MODE_SWITCH_TIMEOUT_MS = 12_000;
const POST_QUESTION_MODE_SWITCH_TIMEOUT_MS = 30_000;
const FINAL_MODE_SWITCH_TIMEOUT_MS = 35_000;
const PLAN_EXIT_QUESTION_TIMEOUT_MS = 15_000;
const TERMINAL_READY_TIMEOUT_MS = 120_000;
const MODE_POLL_INTERVAL_MS = 500;
const CELL_TEMPLATE_LABEL = "E2E Template";
const OPENCODE_ATTACH_URL_PATTERN = /attach\s+"([^"]+)"/;
const TERMINAL_MODE_STATUS_PATTERN = /\b(Plan|Build)\b[\s\S]{0,120}OpenCode/g;
const BUILD_ACTIVITY_PATTERN = /\bBuild\b[\s\S]{0,25}big-pickle/i;
const PLAN_EXIT_QUESTION_PATTERN =
  /Would you like to switch to the build[\s\S]{0,80}start implementing\?/i;
const BUILD_MODE_PROMPT_TEXT =
  "Switch to build mode and acknowledge with a short response.";

test.describe("plan mode @plan-mode", () => {
  test("@plan-mode defaults new cells to plan mode", async ({ page }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    const cellId = await createCellViaApi({
      apiUrl,
      name: `Plan Mode Default ${Date.now()}`,
      templateLabel: CELL_TEMPLATE_LABEL,
    });

    await page.goto(`/cells/${cellId}/chat`);

    await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });

    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await waitForSessionMode({
      apiUrl,
      cellId,
      expectedStartMode: "plan",
      expectedCurrentMode: "plan",
    });
    await waitForTerminalMode({ page, expectedMode: "Plan" });
  });

  test("@plan-mode honors explicit build start mode", async ({ page }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    const cellId = await createCellViaApi({
      apiUrl,
      name: `Build Mode Override ${Date.now()}`,
      templateLabel: CELL_TEMPLATE_LABEL,
      startMode: "build",
    });

    await page.goto(`/cells/${cellId}/chat`);

    await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });

    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await waitForSessionMode({
      apiUrl,
      cellId,
      expectedStartMode: "build",
      expectedCurrentMode: "build",
    });
    await waitForTerminalMode({ page, expectedMode: "Build" });
  });

  test("@plan-mode transitions from plan to build during chat flow", async ({
    page,
  }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    const cellId = await createCellViaApi({
      apiUrl,
      name: `Plan To Build ${Date.now()}`,
      templateLabel: CELL_TEMPLATE_LABEL,
    });

    await page.goto(`/cells/${cellId}/chat`);

    await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });

    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await waitForSessionMode({
      apiUrl,
      cellId,
      expectedStartMode: "plan",
      expectedCurrentMode: "plan",
    });

    const cell = await fetchCellDetails(apiUrl, cellId);
    if (!(cell.opencodeSessionId && cell.opencodeCommand)) {
      throw new Error("Cell is missing OpenCode session metadata");
    }

    await ensureTerminalReady(page, {
      context: "plan-to-build transition prompt",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    await sendTerminalCommand(page, BUILD_MODE_PROMPT_TEXT);

    const opencodeServerUrl = parseOpencodeServerUrl(cell.opencodeCommand);
    const switchedViaUi = await waitForSessionMode({
      apiUrl,
      cellId,
      expectedStartMode: "plan",
      expectedCurrentMode: "build",
      timeoutMs: UI_MODE_SWITCH_TIMEOUT_MS,
      failOnTimeout: false,
    });

    let switchedAfterQuestionReply = false;
    if (!switchedViaUi) {
      const repliedToQuestion = await submitPlanExitQuestionFromTerminal(page);

      if (repliedToQuestion) {
        switchedAfterQuestionReply = await waitForSessionMode({
          apiUrl,
          cellId,
          expectedStartMode: "plan",
          expectedCurrentMode: "build",
          timeoutMs: POST_QUESTION_MODE_SWITCH_TIMEOUT_MS,
          failOnTimeout: false,
        });
      }
    }

    if (!(switchedViaUi || switchedAfterQuestionReply)) {
      await sendBuildModePromptViaOpencode({
        opencodeServerUrl,
        sessionId: cell.opencodeSessionId,
        workspacePath: cell.workspacePath,
      });

      await submitPlanExitQuestionFromTerminal(page);
    }

    await waitForSessionMode({
      apiUrl,
      cellId,
      expectedStartMode: "plan",
      expectedCurrentMode: "build",
      timeoutMs: FINAL_MODE_SWITCH_TIMEOUT_MS,
    });
    await waitForBuildActivity({ page });
  });
});

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

async function fetchAgentSession(
  apiUrl: string,
  cellId: string
): Promise<AgentSession | null> {
  const response = await fetch(
    `${apiUrl}/api/agents/sessions/byCell/${cellId}`
  );
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as AgentSessionResponse;
  return payload.session;
}

async function fetchCellDetails(
  apiUrl: string,
  cellId: string
): Promise<CellDetails> {
  const response = await fetch(`${apiUrl}/api/cells/${cellId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch cell details for ${cellId}`);
  }

  return (await response.json()) as CellDetails;
}

function parseOpencodeServerUrl(opencodeCommand: string): string {
  const match = opencodeCommand.match(OPENCODE_ATTACH_URL_PATTERN);
  if (!match?.[1]) {
    throw new Error("Unable to parse OpenCode attach URL from opencodeCommand");
  }

  return match[1];
}

async function sendBuildModePromptViaOpencode(options: {
  opencodeServerUrl: string;
  sessionId: string;
  workspacePath: string;
}): Promise<void> {
  const query = new URLSearchParams({ directory: options.workspacePath });
  const response = await fetch(
    `${options.opencodeServerUrl}/session/${options.sessionId}/message?${query.toString()}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agent: "build",
        parts: [
          {
            type: "text",
            text: BUILD_MODE_PROMPT_TEXT,
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to send build-mode prompt via OpenCode server (status ${response.status})`
    );
  }
}

async function submitPlanExitQuestionFromTerminal(
  page: Page
): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < PLAN_EXIT_QUESTION_TIMEOUT_MS) {
    const content =
      (await page.locator(selectors.terminalRoot).textContent()) ?? "";
    if (PLAN_EXIT_QUESTION_PATTERN.test(content)) {
      await page.locator(selectors.terminalInputSurface).click();
      await page.keyboard.press("Enter");
      return true;
    }

    await wait(MODE_POLL_INTERVAL_MS);
  }

  return false;
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
      const matches = [...content.matchAll(TERMINAL_MODE_STATUS_PATTERN)];
      const latest = matches.at(-1)?.[1];
      return latest === options.expectedMode;
    },
  });
}

async function waitForBuildActivity(options: { page: Page }): Promise<void> {
  await waitForCondition({
    timeoutMs: FINAL_MODE_SWITCH_TIMEOUT_MS,
    errorMessage: "Terminal did not show build activity",
    check: async () => {
      const content =
        (await options.page.locator(selectors.terminalRoot).textContent()) ??
        "";
      return BUILD_ACTIVITY_PATTERN.test(content);
    },
  });
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
