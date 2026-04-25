import { type Page, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCellViaApi,
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
const PLAN_TO_BUILD_TEST_TIMEOUT_MS = 300_000;
const MODE_POLL_INTERVAL_MS = 500;
const OPENCODE_REQUEST_TIMEOUT_MS = 10_000;
const CELL_TEMPLATE_LABEL = "E2E Template";
const OPENCODE_ATTACH_URL_PATTERN = /attach\s+"([^"]+)"/;
const TERMINAL_MODE_OPEN_CODE_PATTERN =
  /\b(Plan|Build)\b[\s\S]{0,200}OpenCode/i;
const BUILD_MODE_PROMPT_TEXT = "Switch to build mode.";

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
    test.setTimeout(PLAN_TO_BUILD_TEST_TIMEOUT_MS);

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

    const opencodeServerUrl = parseOpencodeServerUrl(cell.opencodeCommand);
    await sendBuildModePromptViaOpencode({
      opencodeServerUrl,
      sessionId: cell.opencodeSessionId,
      workspacePath: cell.workspacePath,
    });

    await waitForTerminalMode({ page, expectedMode: "Build" });
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
  const response = await fetchWithTimeout(
    `${options.opencodeServerUrl}/session/${options.sessionId}/prompt_async?${query.toString()}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agent: "build",
        noReply: true,
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
      `Failed to switch OpenCode mode via prompt_async (status ${response.status})`
    );
  }
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
      if (
        new RegExp(`${options.expectedMode}\\s*[·•]\\s*Big Pickle`, "i").test(
          normalized
        )
      ) {
        return true;
      }

      const openCodeMatch = normalized.match(TERMINAL_MODE_OPEN_CODE_PATTERN);
      return openCodeMatch?.[1] === options.expectedMode;
    },
  });
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, OPENCODE_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
