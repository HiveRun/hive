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
const SESSION_UPDATE_TIMEOUT_MS = 120_000;
const ASSISTANT_OUTPUT_TIMEOUT_MS = 120_000;
const RESPONSE_SETTLE_TIMEOUT_MS = 30_000;
const SESSION_STABLE_WINDOW_MS = 3000;
const OUTPUT_QUIET_WINDOW_MS = 3000;
const MIN_RESPONSE_GROWTH_CHARS = 20;
const SEND_ATTEMPTS = 2;
const SEND_ATTEMPT_TIMEOUT_MS = 20_000;
const FINAL_VIDEO_SETTLE_MS = 1500;
const POLL_INTERVAL_MS = 500;
const CELL_CHAT_URL_PATTERN = /\/cells\/[^/]+\/chat/;
const CELL_ID_PATTERN = /\/cells\/([^/]+)\/chat/;

test.describe("cell chat flow", () => {
  test("creates a cell and sends a chat message", async ({
    page,
  }, testInfo) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    await page.locator(selectors.workspaceCreateCellButton).click();

    const testCellName = `E2E Cell ${Date.now()}`;
    await page.locator(selectors.cellNameInput).fill(testCellName);
    await page.locator(selectors.cellSubmitButton).click();

    await expect(page).toHaveURL(CELL_CHAT_URL_PATTERN, {
      timeout: CHAT_ROUTE_TIMEOUT_MS,
    });

    const cellId = parseCellIdFromUrl(page.url());

    await expect
      .poll(
        async () =>
          page
            .locator(selectors.terminalConnectionBadge)
            .getAttribute("data-connection-state"),
        {
          timeout: TERMINAL_READY_TIMEOUT_MS,
          message: "Terminal connection never reached online state",
        }
      )
      .toBe("online");

    await expect(page.locator(selectors.terminalReadySurface)).toBeVisible({
      timeout: TERMINAL_READY_TIMEOUT_MS,
    });

    const prompt = `E2E token ${Date.now()}`;
    const baselineMetrics = await readTerminalMetrics(page);

    await sendPromptWithRetries({
      apiUrl,
      baselineMetrics,
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

async function waitForSessionToSettle(
  apiUrl: string,
  cellId: string,
  previousUpdatedAt: string
): Promise<void> {
  let latestUpdatedAt = "";
  let stableSince = 0;

  await waitForCondition({
    check: async () => {
      const session = await fetchAgentSession(apiUrl, cellId);
      if (!session) {
        return false;
      }

      if (session.updatedAt !== latestUpdatedAt) {
        latestUpdatedAt = session.updatedAt;
        stableSince = Date.now();
        return false;
      }

      if (session.updatedAt === previousUpdatedAt) {
        return false;
      }

      if (session.status === "working" || session.status === "starting") {
        return false;
      }

      return Date.now() - stableSince >= SESSION_STABLE_WINDOW_MS;
    },
    errorMessage: "Agent session did not reach a stable post-send state",
    intervalMs: 1000,
    timeoutMs: RESPONSE_SETTLE_TIMEOUT_MS,
  });
}

async function sendPromptWithRetries(options: {
  apiUrl: string;
  baselineMetrics: TerminalMetrics;
  cellId: string;
  page: Page;
  prompt: string;
}): Promise<void> {
  let baselineSession = await waitForAgentSession(
    options.apiUrl,
    options.cellId
  );

  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
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
      await waitForAssistantOutput({
        apiUrl: options.apiUrl,
        baselineMetrics: options.baselineMetrics,
        cellId: options.cellId,
        firstUpdateAt: updated.updatedAt,
        page: options.page,
        prompt: options.prompt,
        timeoutMs: ASSISTANT_OUTPUT_TIMEOUT_MS,
      });

      await waitForSessionToSettle(
        options.apiUrl,
        options.cellId,
        updated.updatedAt
      ).catch((error) => error);
      return;
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
  firstUpdateAt: string;
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

      const hasSecondSessionUpdate =
        currentSession?.updatedAt !== undefined &&
        currentSession.updatedAt !== options.firstUpdateAt;

      const outputSeqGrowth =
        metrics.outputSeq - options.baselineMetrics.outputSeq;
      const outputLengthGrowth =
        metrics.outputLength - options.baselineMetrics.outputLength;

      const outputSuggestsAssistantResponse =
        outputSeqGrowth >= 2 ||
        outputLengthGrowth >= options.prompt.length + MIN_RESPONSE_GROWTH_CHARS;

      const hasResponseSignal =
        hasSecondSessionUpdate || outputSuggestsAssistantResponse;

      if (!hasResponseSignal || metrics.outputUpdatedAt <= 0) {
        return false;
      }

      return Date.now() - metrics.outputUpdatedAt >= OUTPUT_QUIET_WINDOW_MS;
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
