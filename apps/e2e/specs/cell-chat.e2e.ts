import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { selectors } from "../src/selectors";

type AgentSession = {
  id: string;
  status: string;
  updatedAt: string;
};

type AgentSessionResponse = {
  session: AgentSession | null;
};

type TerminalMetrics = {
  outputLength: number;
  outputSeq: number;
  outputUpdatedAt: number;
};

const CHAT_ROUTE_TIMEOUT_MS = 120_000;
const TERMINAL_READY_TIMEOUT_MS = 120_000;
const TERMINAL_INPUT_READY_TIMEOUT_MS = 30_000;
const SESSION_UPDATE_TIMEOUT_MS = 120_000;
const ASSISTANT_OUTPUT_TIMEOUT_MS = 120_000;
const MIN_RESPONSE_GROWTH_CHARS = 80;
const SEND_ATTEMPTS = 2;
const MAX_TERMINAL_RESTARTS = 2;
const SEND_ATTEMPT_TIMEOUT_MS = 20_000;
const FINAL_VIDEO_SETTLE_MS = 1500;
const POLL_INTERVAL_MS = 500;
const TERMINAL_RECOVERY_WAIT_MS = 750;
const TEMPLATE_OPTION_TIMEOUT_MS = 750;
const CELL_CHAT_URL_PATTERN = /\/cells\/[^/]+\/chat/;
const CELL_ID_PATTERN = /\/cells\/([^/]+)\/chat/;
const PREFERRED_TEMPLATE_LABELS = ["Basic Template", "E2E Template"];
const USE_DEFAULT_TEMPLATE = process.env.HIVE_E2E_USE_DEFAULT_TEMPLATE === "1";

test.describe("cell chat flow", () => {
  test("creates a cell and sends a chat message", async ({
    page,
  }, testInfo) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    await openCellCreationSheet(page);

    const testCellName = `E2E Cell ${Date.now()}`;
    await page.locator(selectors.cellNameInput).fill(testCellName);
    if (!USE_DEFAULT_TEMPLATE) {
      await selectPreferredTemplate(page);
    }
    await page.locator(selectors.cellSubmitButton).click();

    await expect(page).toHaveURL(CELL_CHAT_URL_PATTERN, {
      timeout: CHAT_ROUTE_TIMEOUT_MS,
    });

    const cellId = parseCellIdFromUrl(page.url());

    await ensureTerminalReady(page, {
      context: "before prompt send",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const prompt = `E2E token ${Date.now()}`;

    await sendPromptWithRetries({
      apiUrl,
      cellId,
      page,
      prompt,
    });

    await attachFinalStateScreenshot({ cellId, page, testInfo });
    await captureFinalVideoFrame(page);
    await page.waitForTimeout(FINAL_VIDEO_SETTLE_MS);
  });
});

function parseCellIdFromUrl(url: string): string {
  const match = url.match(CELL_ID_PATTERN);
  if (!match?.[1]) {
    throw new Error(`Failed to parse cell ID from URL: ${url}`);
  }
  return match[1];
}

async function waitForAgentSession(
  apiUrl: string,
  cellId: string
): Promise<AgentSession> {
  await waitForCondition({
    check: async () => {
      const session = await fetchAgentSession(apiUrl, cellId);
      return Boolean(session);
    },
    errorMessage: "Agent session was not available for the created cell",
    timeoutMs: SESSION_UPDATE_TIMEOUT_MS,
  });

  const session = await fetchAgentSession(apiUrl, cellId);
  if (!session) {
    throw new Error("Agent session missing after successful wait");
  }

  return session;
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

async function sendPromptWithRetries(options: {
  apiUrl: string;
  cellId: string;
  page: Page;
  prompt: string;
}): Promise<void> {
  let baselineSession = await waitForAgentSession(
    options.apiUrl,
    options.cellId
  );

  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    await ensureTerminalReady(options.page, {
      context: `send attempt ${String(attempt)}`,
      timeoutMs: TERMINAL_INPUT_READY_TIMEOUT_MS,
    });

    const baselineMetrics = await readTerminalMetrics(options.page);

    await focusTerminalInput(options.page);
    await options.page.keyboard.type(options.prompt);
    await options.page.keyboard.press("Enter");

    const updated = await waitForSessionUpdate(
      options.apiUrl,
      options.cellId,
      baselineSession,
      SEND_ATTEMPT_TIMEOUT_MS
    );

    if (updated) {
      try {
        await waitForAssistantOutput({
          apiUrl: options.apiUrl,
          baselineMetrics,
          cellId: options.cellId,
          page: options.page,
          prompt: options.prompt,
          timeoutMs: ASSISTANT_OUTPUT_TIMEOUT_MS,
        });
        return;
      } catch (error) {
        if (attempt >= SEND_ATTEMPTS) {
          throw error;
        }
      }
    }

    baselineSession = await waitForAgentSession(options.apiUrl, options.cellId);
  }

  throw new Error(
    "Agent session did not update after sending chat input across retries"
  );
}

async function waitForSessionUpdate(
  apiUrl: string,
  cellId: string,
  baselineSession: AgentSession,
  timeoutMs: number
): Promise<AgentSession | null> {
  let updatedSession: AgentSession | null = null;

  try {
    await waitForCondition({
      check: async () => {
        const currentSession = await fetchAgentSession(apiUrl, cellId);
        if (!currentSession) {
          return false;
        }

        const changed =
          currentSession.updatedAt !== baselineSession.updatedAt ||
          currentSession.status !== baselineSession.status;

        if (changed) {
          updatedSession = currentSession;
        }

        return changed;
      },
      errorMessage: "Session did not update after prompt send",
      intervalMs: 1000,
      timeoutMs,
    });

    return updatedSession;
  } catch {
    return null;
  }
}

async function waitForAssistantOutput(options: {
  apiUrl: string;
  baselineMetrics: TerminalMetrics;
  cellId: string;
  page: Page;
  prompt: string;
  timeoutMs: number;
}): Promise<void> {
  await waitForCondition({
    check: async () => {
      const metrics = await readTerminalMetrics(options.page);
      const currentSession = await fetchAgentSession(
        options.apiUrl,
        options.cellId
      );

      if (!currentSession) {
        return false;
      }

      const outputSeqGrowth =
        metrics.outputSeq - options.baselineMetrics.outputSeq;
      const outputLengthGrowth =
        metrics.outputLength - options.baselineMetrics.outputLength;

      const outputSuggestsAssistantResponse =
        outputSeqGrowth >= 2 ||
        outputLengthGrowth >= options.prompt.length + MIN_RESPONSE_GROWTH_CHARS;

      return (
        outputSuggestsAssistantResponse &&
        currentSession.status === "awaiting_input"
      );
    },
    errorMessage:
      "Agent response was not observed in terminal output after sending prompt",
    intervalMs: 1000,
    timeoutMs: options.timeoutMs,
  });
}

async function readTerminalMetrics(page: Page): Promise<TerminalMetrics> {
  const terminalRoot = page.locator(selectors.terminalRoot);

  const [outputLengthRaw, outputSeqRaw, outputUpdatedAtRaw] = await Promise.all(
    [
      terminalRoot.getAttribute("data-terminal-output-length"),
      terminalRoot.getAttribute("data-terminal-output-seq"),
      terminalRoot.getAttribute("data-terminal-output-updated-at"),
    ]
  );

  return {
    outputLength: Number(outputLengthRaw ?? "0"),
    outputSeq: Number(outputSeqRaw ?? "0"),
    outputUpdatedAt: Number(outputUpdatedAtRaw ?? "0"),
  };
}

async function focusTerminalInput(page: Page): Promise<void> {
  await page.locator(selectors.terminalInputSurface).click();
  await page.locator(selectors.terminalInputTextarea).focus();

  await waitForCondition({
    check: async () =>
      page.evaluate(() => {
        const active = document.activeElement;
        return active?.classList.contains("xterm-helper-textarea") ?? false;
      }),
    errorMessage: "Terminal input textarea did not receive focus",
    timeoutMs: 10_000,
  });
}

async function openCellCreationSheet(page: Page): Promise<void> {
  await maybeRecoverRouteError(page);

  const createCellButtons = page.locator(selectors.workspaceCreateCellButton);
  await createCellButtons.first().waitFor({
    state: "visible",
    timeout: CHAT_ROUTE_TIMEOUT_MS,
  });
  const buttonCount = await createCellButtons.count();

  for (let index = 0; index < buttonCount; index += 1) {
    await createCellButtons.nth(index).click();

    const formVisible = await page
      .locator(selectors.cellNameInput)
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (formVisible) {
      return;
    }

    await maybeRecoverRouteError(page);
  }

  throw new Error("Failed to open create-cell form for any workspace");
}

async function selectPreferredTemplate(page: Page): Promise<void> {
  const trigger = page.locator(selectors.templateSelectTrigger);
  const hasTemplateSelect = await trigger
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (!hasTemplateSelect) {
    return;
  }

  await trigger.click();

  for (const label of PREFERRED_TEMPLATE_LABELS) {
    const option = page.getByRole("option", { name: label });
    const isVisible = await option
      .isVisible({ timeout: TEMPLATE_OPTION_TIMEOUT_MS })
      .catch(() => false);

    if (isVisible) {
      await option.click();
      return;
    }
  }

  await page.keyboard.press("Escape").catch(() => null);
}

async function maybeRecoverRouteError(page: Page): Promise<void> {
  const tryAgainButton = page.getByRole("button", { name: "Try again" });
  const isVisible = await tryAgainButton
    .isVisible({ timeout: 500 })
    .catch(() => false);

  if (!isVisible) {
    return;
  }

  await tryAgainButton.click();
  await page.waitForTimeout(POLL_INTERVAL_MS);
}

async function ensureTerminalReady(
  page: Page,
  options: {
    context: string;
    timeoutMs: number;
  }
): Promise<void> {
  let restartCount = 0;
  let lastState = "unknown";
  let lastExitCode = "";
  let lastErrorMessage = "";

  await waitForCondition({
    check: async () => {
      const badge = page.locator(selectors.terminalConnectionBadge);
      const terminalRoot = page.locator(selectors.terminalRoot);
      const [state, exitCode, exitSignal] = await Promise.all([
        badge.getAttribute("data-connection-state"),
        badge.getAttribute("data-exit-code"),
        terminalRoot.getAttribute("data-terminal-error-message"),
      ]);

      lastState = state ?? "unknown";
      lastExitCode = exitCode ?? "";
      lastErrorMessage = exitSignal ?? "";

      if (state === "online") {
        return page.locator(selectors.terminalInputTextarea).isVisible();
      }

      if (state === "exited" || state === "disconnected") {
        if (restartCount >= MAX_TERMINAL_RESTARTS) {
          throw new Error(
            `Terminal remained ${state} during ${options.context}. exitCode=${lastExitCode || "n/a"} error=${lastErrorMessage || "n/a"}`
          );
        }

        await page.locator(selectors.terminalRestartButton).click();
        restartCount += 1;
        await page.waitForTimeout(TERMINAL_RECOVERY_WAIT_MS);
      }

      return false;
    },
    errorMessage: `Terminal not ready during ${options.context}. Last state=${lastState} exitCode=${lastExitCode || "n/a"} error=${lastErrorMessage || "n/a"} restarts=${String(restartCount)}`,
    timeoutMs: options.timeoutMs,
  });
}

async function attachFinalStateScreenshot(options: {
  cellId: string;
  page: Page;
  testInfo: TestInfo;
}): Promise<void> {
  const screenshotBuffer = await options.page.screenshot();
  await options.testInfo.attach(`Final terminal state (${options.cellId})`, {
    body: screenshotBuffer,
    contentType: "image/png",
  });
}

async function captureFinalVideoFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    const terminal = document.querySelector('[data-testid="cell-terminal"]');
    terminal?.setAttribute("data-e2e-final-frame", String(Date.now()));
  });
}

async function waitForCondition(options: {
  check: () => Promise<boolean>;
  errorMessage: string;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<void> {
  const startedAt = Date.now();
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;

  while (Date.now() - startedAt < options.timeoutMs) {
    if (await options.check()) {
      return;
    }
    await wait(intervalMs);
  }

  throw new Error(options.errorMessage);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
