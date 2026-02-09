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

type AgentMessage = {
  id: string;
  role: string;
  state: string;
  content: string | null;
};

type AgentMessageListResponse = {
  messages: AgentMessage[];
};

type TerminalMetrics = {
  visibleOutputLength: number;
  outputLength: number;
  outputSeq: number;
  outputUpdatedAt: number;
};

const CHAT_ROUTE_TIMEOUT_MS = 120_000;
const TERMINAL_READY_TIMEOUT_MS = 120_000;
const TERMINAL_INPUT_READY_TIMEOUT_MS = 30_000;
const SESSION_UPDATE_TIMEOUT_MS = 120_000;
const ASSISTANT_OUTPUT_TIMEOUT_MS = 25_000;
const MIN_VISIBLE_RESPONSE_TAIL_CHARS = 12;
const MIN_TERMINAL_MATCH_TOKEN_LENGTH = 4;
const MIN_REPEATED_TOKEN_LENGTH = 6;
const SEND_ATTEMPTS = 2;
const MAX_TERMINAL_RESTARTS = 2;
const SEND_ATTEMPT_TIMEOUT_MS = 20_000;
const POST_RESPONSE_VIDEO_SETTLE_MS = 500;
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
    await expect(page.locator(selectors.cellSubmitButton)).toBeEnabled({
      timeout: CHAT_ROUTE_TIMEOUT_MS,
    });
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
    const baselineMessages = await fetchAgentMessages(
      options.apiUrl,
      baselineSession.id
    );
    const baselineMessageIds = new Set(
      baselineMessages.map((message) => message.id)
    );

    await focusTerminalInput(options.page);
    await options.page.keyboard.type(options.prompt);
    await options.page.keyboard.press("Enter");

    const promptAccepted = await waitForPromptAccepted({
      apiUrl: options.apiUrl,
      baselineMetrics,
      baselineSession,
      cellId: options.cellId,
      page: options.page,
      timeoutMs: SEND_ATTEMPT_TIMEOUT_MS,
    });

    if (promptAccepted) {
      try {
        await waitForAssistantOutput({
          apiUrl: options.apiUrl,
          baselineMessageIds,
          baselineMetrics,
          cellId: options.cellId,
          page: options.page,
          prompt: options.prompt,
          timeoutMs: ASSISTANT_OUTPUT_TIMEOUT_MS,
        });
        await options.page.waitForTimeout(POST_RESPONSE_VIDEO_SETTLE_MS);
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
    "Prompt was not accepted after sending chat input across retries"
  );
}

async function waitForPromptAccepted(options: {
  apiUrl: string;
  baselineMetrics: TerminalMetrics;
  baselineSession: AgentSession;
  cellId: string;
  page: Page;
  timeoutMs: number;
}): Promise<boolean> {
  let promptAccepted = false;

  try {
    await waitForCondition({
      check: async () => {
        const currentSession = await fetchAgentSession(
          options.apiUrl,
          options.cellId
        );
        const metrics = await readTerminalMetrics(options.page);

        const sessionChanged =
          currentSession != null &&
          (currentSession.updatedAt !== options.baselineSession.updatedAt ||
            currentSession.status !== options.baselineSession.status);

        const outputChanged =
          metrics.outputSeq > options.baselineMetrics.outputSeq ||
          metrics.outputLength > options.baselineMetrics.outputLength;

        if (sessionChanged || outputChanged) {
          promptAccepted = true;
        }

        return sessionChanged || outputChanged;
      },
      errorMessage: "Prompt did not change terminal output or session state",
      intervalMs: 1000,
      timeoutMs: options.timeoutMs,
    });

    return promptAccepted;
  } catch {
    return false;
  }
}

async function waitForAssistantOutput(options: {
  apiUrl: string;
  baselineMessageIds: ReadonlySet<string>;
  baselineMetrics: TerminalMetrics;
  cellId: string;
  page: Page;
  prompt: string;
  timeoutMs: number;
}): Promise<void> {
  await waitForCondition({
    check: async () => {
      const metrics = await readTerminalMetrics(options.page);
      const visibleOutput = await readVisibleTerminalText(options.page);
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

      const outputChangedAfterPrompt =
        outputSeqGrowth > 0 || outputLengthGrowth > options.prompt.length;

      const messages = await fetchAgentMessages(
        options.apiUrl,
        currentSession.id
      );
      const latestAssistantMessage = findLatestAssistantMessage(
        messages,
        options.baselineMessageIds
      );
      if (!latestAssistantMessage?.content) {
        return false;
      }

      const responseVisible = doesTerminalContainAssistantResponse({
        assistantContent: latestAssistantMessage.content,
        prompt: options.prompt,
        terminalVisibleText: visibleOutput,
      });

      const visibleOutputGrowth =
        metrics.visibleOutputLength -
        options.baselineMetrics.visibleOutputLength;
      const visibleOutputGrowthBeyondPrompt =
        visibleOutputGrowth - options.prompt.length;
      const visibleSuggestsAssistantResponse =
        visibleOutputGrowthBeyondPrompt >= MIN_VISIBLE_RESPONSE_TAIL_CHARS;

      return (
        (outputChangedAfterPrompt || visibleSuggestsAssistantResponse) &&
        responseVisible &&
        currentSession.status === "awaiting_input"
      );
    },
    errorMessage:
      "Agent response was not observed in terminal output after sending prompt",
    intervalMs: 1000,
    timeoutMs: options.timeoutMs,
  });
}

async function fetchAgentMessages(
  apiUrl: string,
  sessionId: string
): Promise<AgentMessage[]> {
  const response = await fetch(
    `${apiUrl}/api/agents/sessions/${sessionId}/messages`
  );
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as AgentMessageListResponse;
  return payload.messages;
}

function findLatestAssistantMessage(
  messages: AgentMessage[],
  baselineMessageIds: ReadonlySet<string>
): AgentMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (baselineMessageIds.has(message.id)) {
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }
    if (!message.content?.trim()) {
      continue;
    }
    return message;
  }

  return null;
}

function doesTerminalContainAssistantResponse(options: {
  assistantContent: string;
  prompt: string;
  terminalVisibleText: string;
}): boolean {
  const terminalTokens = tokenizeText(options.terminalVisibleText);
  const assistantTokens = tokenizeText(options.assistantContent);
  if (assistantTokens.length === 0) {
    return false;
  }

  const promptTokenSet = new Set(tokenizeText(options.prompt));
  const novelAssistantTokens = assistantTokens.filter(
    (token) => !promptTokenSet.has(token)
  );

  if (novelAssistantTokens.length > 0) {
    let matchedNovelTokens = 0;
    for (const token of novelAssistantTokens) {
      if (terminalTokens.includes(token)) {
        matchedNovelTokens += 1;
      }
    }

    return matchedNovelTokens >= Math.min(2, novelAssistantTokens.length);
  }

  const normalizedTerminal = normalizeText(options.terminalVisibleText);
  for (const token of assistantTokens) {
    if (token.length < MIN_REPEATED_TOKEN_LENGTH) {
      continue;
    }
    if (countOccurrences(normalizedTerminal, token) >= 2) {
      return true;
    }
  }

  return false;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeText(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TERMINAL_MATCH_TOKEN_LENGTH);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle.length) {
    return 0;
  }

  let count = 0;
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) {
      break;
    }
    count += 1;
    cursor = index + needle.length;
  }

  return count;
}

async function readVisibleTerminalText(page: Page): Promise<string> {
  return await page
    .locator(selectors.terminalInputSurface)
    .innerText()
    .catch(() => "");
}

async function readTerminalMetrics(page: Page): Promise<TerminalMetrics> {
  const terminalRoot = page.locator(selectors.terminalRoot);

  const [
    visibleOutputLengthRaw,
    outputLengthRaw,
    outputSeqRaw,
    outputUpdatedAtRaw,
  ] = await Promise.all([
    terminalRoot.getAttribute("data-terminal-visible-output-length"),
    terminalRoot.getAttribute("data-terminal-output-length"),
    terminalRoot.getAttribute("data-terminal-output-seq"),
    terminalRoot.getAttribute("data-terminal-output-updated-at"),
  ]);

  return {
    visibleOutputLength: Number(visibleOutputLengthRaw ?? "0"),
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
