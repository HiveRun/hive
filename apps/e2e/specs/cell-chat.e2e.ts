import allureReporter from "@wdio/allure-reporter";
import { $, browser } from "@wdio/globals";
import { selectors } from "../src/selectors";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => Promise<void>) => void;

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
const CELL_CHAT_URL_PATTERN = /\/cells\/[^/]+\/chat/;
const CELL_ID_PATTERN = /\/cells\/([^/]+)\/chat/;

describe("cell chat flow", () => {
  it("creates a cell and sends a chat message", async () => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await browser.url("/");

    const createCellButton = await $(selectors.workspaceCreateCellButton);
    await createCellButton.waitForClickable({ timeout: CHAT_ROUTE_TIMEOUT_MS });
    await createCellButton.click();

    const cellNameInput = await $(selectors.cellNameInput);
    await cellNameInput.waitForDisplayed({ timeout: CHAT_ROUTE_TIMEOUT_MS });

    const testCellName = `E2E Cell ${Date.now()}`;
    await cellNameInput.setValue(testCellName);

    const submitButton = await $(selectors.cellSubmitButton);
    await submitButton.click();

    await browser.waitUntil(
      async () => {
        const url = await browser.getUrl();
        return CELL_CHAT_URL_PATTERN.test(url);
      },
      {
        timeout: CHAT_ROUTE_TIMEOUT_MS,
        timeoutMsg: "Expected to navigate to cell chat route after creation",
      }
    );

    const chatUrl = await browser.getUrl();
    const cellId = parseCellIdFromUrl(chatUrl);

    const terminalConnectionBadge = await $(selectors.terminalConnectionBadge);
    await browser.waitUntil(
      async () => {
        const state = await terminalConnectionBadge.getAttribute(
          "data-connection-state"
        );
        return state === "online";
      },
      {
        timeout: TERMINAL_READY_TIMEOUT_MS,
        timeoutMsg: "Terminal connection never reached online state",
      }
    );

    await browser.waitUntil(
      async () => {
        const terminalReadySurface = await $(selectors.terminalReadySurface);
        return terminalReadySurface.isExisting();
      },
      {
        timeout: TERMINAL_READY_TIMEOUT_MS,
        timeoutMsg: "Terminal shell was not marked ready for input",
      }
    );

    const prompt = `E2E token ${Date.now()}`;
    const baselineMetrics = await readTerminalMetrics();
    await sendPromptWithRetries(apiUrl, cellId, prompt, baselineMetrics);
    await attachFinalStateScreenshot(cellId);
    await captureFinalVideoFrame();
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
  await browser.waitUntil(
    async () => {
      const session = await fetchAgentSession(apiUrl, cellId);
      return Boolean(session);
    },
    {
      timeout: SESSION_UPDATE_TIMEOUT_MS,
      timeoutMsg: "Agent session was not available for the created cell",
    }
  );

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

  await browser.waitUntil(
    async () => {
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
    {
      timeout: RESPONSE_SETTLE_TIMEOUT_MS,
      timeoutMsg: "Agent session did not reach a stable post-send state",
      interval: 1000,
    }
  );
}

async function sendPromptWithRetries(
  apiUrl: string,
  cellId: string,
  prompt: string,
  baselineMetrics: TerminalMetrics
): Promise<void> {
  let baselineSession = await waitForAgentSession(apiUrl, cellId);

  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    await focusTerminalInput();
    await browser.keys(prompt);
    await browser.keys("Enter");

    const updated = await waitForSessionUpdate(
      apiUrl,
      cellId,
      baselineSession,
      SEND_ATTEMPT_TIMEOUT_MS
    );

    if (updated) {
      await waitForAssistantOutput({
        apiUrl,
        baselineMetrics,
        cellId,
        firstUpdateAt: updated.updatedAt,
        prompt,
        timeoutMs: ASSISTANT_OUTPUT_TIMEOUT_MS,
      });

      await waitForSessionToSettle(apiUrl, cellId, updated.updatedAt).catch(
        (error) => error
      );
      return;
    }

    baselineSession = await waitForAgentSession(apiUrl, cellId);
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
    await browser.waitUntil(
      async () => {
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
      {
        timeout: timeoutMs,
        interval: 1000,
      }
    );
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
  prompt: string;
  timeoutMs: number;
}): Promise<void> {
  await browser.waitUntil(
    async () => {
      const metrics = await readTerminalMetrics();
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
    {
      timeout: options.timeoutMs,
      interval: 1000,
      timeoutMsg:
        "Agent response was not observed in terminal output after sending prompt",
    }
  );
}

async function readTerminalMetrics(): Promise<TerminalMetrics> {
  const terminalRoot = await $(selectors.terminalRoot);

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

async function focusTerminalInput(): Promise<void> {
  const terminalInputSurface = await $(selectors.terminalInputSurface);
  await terminalInputSurface.waitForDisplayed({
    timeout: TERMINAL_READY_TIMEOUT_MS,
  });
  await terminalInputSurface.click();

  const inputTextarea = await $(selectors.terminalInputTextarea);
  await inputTextarea.waitForExist({ timeout: TERMINAL_READY_TIMEOUT_MS });
  await browser.execute(() => {
    const textarea = document.querySelector(
      '[data-testid="cell-terminal-input"] .xterm-helper-textarea'
    ) as HTMLTextAreaElement | null;
    textarea?.focus();
  });

  await browser.waitUntil(
    async () => {
      const isFocused = await browser.execute(() => {
        const active = document.activeElement;
        return active?.classList.contains("xterm-helper-textarea") ?? false;
      });
      return isFocused;
    },
    {
      timeout: 10_000,
      timeoutMsg: "Terminal input textarea did not receive focus",
    }
  );
}

async function attachFinalStateScreenshot(cellId: string): Promise<void> {
  const screenshotBase64 = await browser.takeScreenshot();
  allureReporter.addAttachment(
    `Final terminal state (${cellId})`,
    Buffer.from(screenshotBase64, "base64"),
    "image/png"
  );
}

async function captureFinalVideoFrame(): Promise<void> {
  await browser.execute(() => {
    const terminal = document.querySelector('[data-testid="cell-terminal"]');
    terminal?.setAttribute("data-e2e-final-frame", String(Date.now()));
  });
}
