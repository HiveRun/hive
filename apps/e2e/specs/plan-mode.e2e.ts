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

type QuestionOption = {
  label?: string;
  description?: string;
};

type PendingQuestion = {
  id?: string;
  sessionID?: string;
  questions?: Array<{
    options?: QuestionOption[];
  }>;
};

const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_ROUTE_TIMEOUT_MS = 180_000;
const SESSION_MODE_TIMEOUT_MS = 120_000;
const BUILD_TRANSITION_TIMEOUT_MS = 170_000;
const PLAN_TO_BUILD_TEST_TIMEOUT_MS = 240_000;
const MODE_POLL_INTERVAL_MS = 500;
const BUILD_PROMPT_RETRY_INTERVAL_MS = 20_000;
const OPENCODE_REQUEST_TIMEOUT_MS = 2500;
const QUESTION_API_NOT_FOUND_STATUS = 404;
const CELL_TEMPLATE_LABEL = "E2E Template";
const OPENCODE_ATTACH_URL_PATTERN = /attach\s+"([^"]+)"/;
const TERMINAL_MODE_STATUS_PATTERN = /\b(Plan|Build)\b[\s\S]{0,120}OpenCode/g;
const PLAN_EXIT_QUESTION_PATTERN =
  /Would you like to switch to the build[\s\S]{0,80}start implementing\?/i;
const BUILD_IMPLEMENT_OPTION_PATTERN = /build\/implement/i;
const QUESTION_PROMPT_HINT_PATTERN = /↑↓\s*select[\s\S]{0,40}enter\s*submit/i;
const YES_LABEL_PATTERN = /^yes$/i;
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
    await sendBuildPromptForTransition({
      apiUrl,
      cellId,
      opencodeServerUrl,
      sessionId: cell.opencodeSessionId,
      workspacePath: cell.workspacePath,
    });

    await waitForPlanToBuildTransition({
      apiUrl,
      cellId,
      page,
      opencodeServerUrl,
      sessionId: cell.opencodeSessionId,
      workspacePath: cell.workspacePath,
      hasSentInitialPrompt: true,
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

async function sendBuildPromptForTransition(options: {
  apiUrl: string;
  cellId: string;
  opencodeServerUrl: string;
  sessionId: string;
  workspacePath: string;
}): Promise<void> {
  await sendBuildModePromptViaOpencode({
    opencodeServerUrl: options.opencodeServerUrl,
    sessionId: options.sessionId,
    workspacePath: options.workspacePath,
  });

  await sendBuildPromptViaChatTerminalApi({
    apiUrl: options.apiUrl,
    cellId: options.cellId,
  });
}

async function sendBuildPromptViaChatTerminalApi(options: {
  apiUrl: string;
  cellId: string;
}): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${options.apiUrl}/api/cells/${options.cellId}/chat/terminal/input`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          data: `${BUILD_MODE_PROMPT_TEXT}\r`,
        }),
      }
    );

    return response.ok;
  } catch {
    return false;
  }
}

async function waitForPlanToBuildTransition(options: {
  apiUrl: string;
  cellId: string;
  page: Page;
  opencodeServerUrl: string;
  sessionId: string;
  workspacePath: string;
  hasSentInitialPrompt: boolean;
}): Promise<void> {
  const startedAt = Date.now();
  let lastPromptAt = options.hasSentInitialPrompt ? Date.now() : 0;

  while (Date.now() - startedAt < BUILD_TRANSITION_TIMEOUT_MS) {
    const switched = await waitForSessionMode({
      apiUrl: options.apiUrl,
      cellId: options.cellId,
      expectedStartMode: "plan",
      expectedCurrentMode: "build",
      timeoutMs: MODE_POLL_INTERVAL_MS,
      failOnTimeout: false,
    });
    if (switched) {
      return;
    }

    await tryHandleBuildTransitionQuestion(options);

    const shouldResendPrompt =
      Date.now() - lastPromptAt >= BUILD_PROMPT_RETRY_INTERVAL_MS;
    if (shouldResendPrompt) {
      await sendBuildPromptForTransition({
        apiUrl: options.apiUrl,
        cellId: options.cellId,
        opencodeServerUrl: options.opencodeServerUrl,
        sessionId: options.sessionId,
        workspacePath: options.workspacePath,
      });
      lastPromptAt = Date.now();
    }

    await wait(MODE_POLL_INTERVAL_MS);
  }

  throw new Error(`Session mode mismatch for cell ${options.cellId}`);
}

async function tryHandleBuildTransitionQuestion(options: {
  page: Page;
  opencodeServerUrl: string;
  sessionId: string;
}): Promise<boolean> {
  if (await submitQuestionViaOpencodeApi(options)) {
    return true;
  }

  const content =
    (await options.page.locator(selectors.terminalRoot).textContent()) ?? "";
  if (PLAN_EXIT_QUESTION_PATTERN.test(content)) {
    await options.page.locator(selectors.terminalInputSurface).click();
    await options.page.keyboard.press("Enter");
    return true;
  }

  if (
    QUESTION_PROMPT_HINT_PATTERN.test(content) &&
    BUILD_IMPLEMENT_OPTION_PATTERN.test(content)
  ) {
    await options.page.locator(selectors.terminalInputSurface).click();
    await options.page.keyboard.press("ArrowDown");
    await options.page.keyboard.press("Enter");
    return true;
  }

  return false;
}

async function submitQuestionViaOpencodeApi(options: {
  opencodeServerUrl: string;
  sessionId: string;
}): Promise<boolean> {
  try {
    const listResponse = await fetchWithTimeout(
      `${options.opencodeServerUrl}/question`
    );
    if (listResponse.status === QUESTION_API_NOT_FOUND_STATUS) {
      return false;
    }
    if (!listResponse.ok) {
      return false;
    }

    const payload = (await listResponse.json()) as unknown;
    if (!Array.isArray(payload)) {
      return false;
    }

    const question = payload.find((candidate) => {
      if (!candidate || typeof candidate !== "object") {
        return false;
      }

      const sessionID = (candidate as PendingQuestion).sessionID;
      return typeof sessionID === "string" && sessionID === options.sessionId;
    }) as PendingQuestion | undefined;

    if (!question || typeof question.id !== "string") {
      return false;
    }

    const answers = buildQuestionAnswers(question);
    const replyResponse = await fetchWithTimeout(
      `${options.opencodeServerUrl}/question/${question.id}/reply`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ answers }),
      }
    );

    return replyResponse.ok;
  } catch {
    return false;
  }
}

function buildQuestionAnswers(question: PendingQuestion): string[][] {
  const prompts = Array.isArray(question.questions) ? question.questions : [];
  if (prompts.length === 0) {
    return [["Yes"]];
  }

  return prompts.map((prompt) => {
    const options = Array.isArray(prompt.options) ? prompt.options : [];
    const labels = options
      .map((option) => {
        if (!option || typeof option !== "object") {
          return "";
        }

        return typeof option.label === "string" ? option.label : "";
      })
      .filter((label) => label.length > 0);

    const buildLabel = labels.find((label) =>
      BUILD_IMPLEMENT_OPTION_PATTERN.test(label)
    );
    if (buildLabel) {
      return [buildLabel];
    }

    const yesLabel = labels.find((label) => YES_LABEL_PATTERN.test(label));
    if (yesLabel) {
      return [yesLabel];
    }

    return [labels[0] ?? "Yes"];
  });
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
