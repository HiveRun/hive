import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import { createCellViaApi } from "../src/test-helpers";

type AgentSession = {
  id: string;
  modelId?: string;
  modelProviderId?: string;
  provider?: string;
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

const CHAT_ROUTE_TIMEOUT_MS = 30_000;
const TERMINAL_READY_TIMEOUT_MS = 120_000;
const TERMINAL_INPUT_READY_TIMEOUT_MS = 30_000;
const SESSION_UPDATE_TIMEOUT_MS = 120_000;
const ASSISTANT_OUTPUT_TIMEOUT_MS = 40_000;
const SEND_ATTEMPTS = 3;
const MAX_TERMINAL_RESTARTS = 2;
const SEND_ATTEMPT_TIMEOUT_MS = 20_000;
const SEND_API_TIMEOUT_MS = 8000;
const POST_RESPONSE_VIDEO_SETTLE_MS = 500;
const POLL_INTERVAL_MS = 500;
const TERMINAL_RECOVERY_WAIT_MS = 750;
const CELL_CHAT_URL_PATTERN = /\/cells\/[^/]+\/chat/;
const CELL_TEMPLATE_LABEL = "E2E Template";
const EXPECTED_MODEL_ID = "big-pickle";
const EXPECTED_MODEL_PROVIDER_ID = "opencode";

test.describe("cell chat flow", () => {
  test("creates a cell and sends a chat message", async ({
    page,
  }, testInfo) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    const cellId = await createCellViaApi({
      apiUrl,
      name: `E2E Cell ${Date.now()}`,
      templateLabel: CELL_TEMPLATE_LABEL,
    });

    await page.goto(`/cells/${cellId}/chat`);

    await expect(page).toHaveURL(CELL_CHAT_URL_PATTERN, {
      timeout: CHAT_ROUTE_TIMEOUT_MS,
    });

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
    await assertSessionModelSelection({
      apiUrl,
      cellId,
      expectedModelId: EXPECTED_MODEL_ID,
      expectedProviderId: EXPECTED_MODEL_PROVIDER_ID,
    });

    await attachFinalStateScreenshot({ cellId, page, testInfo });
    await captureFinalVideoFrame(page);
  });
});

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

    const baselineMessages = await fetchAgentMessages(
      options.apiUrl,
      baselineSession.id
    );
    const baselineMessageIds = new Set(
      baselineMessages.map((message) => message.id)
    );

    await sendPrompt(options);

    const acceptedAfterApiWrite = await waitForPromptAccepted({
      apiUrl: options.apiUrl,
      baselineMessageIds,
      baselineSession,
      cellId: options.cellId,
      prompt: options.prompt,
      timeoutMs: SEND_API_TIMEOUT_MS,
    });

    const promptAccepted = acceptedAfterApiWrite
      ? true
      : await waitForPromptAcceptedViaKeyboard({
          apiUrl: options.apiUrl,
          baselineMessageIds,
          baselineSession,
          cellId: options.cellId,
          page: options.page,
          prompt: options.prompt,
        });

    if (promptAccepted) {
      try {
        await waitForAssistantOutput({
          apiUrl: options.apiUrl,
          baselineMessageIds,
          cellId: options.cellId,
          page: options.page,
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

async function waitForPromptAcceptedViaKeyboard(options: {
  apiUrl: string;
  baselineMessageIds: ReadonlySet<string>;
  baselineSession: AgentSession;
  cellId: string;
  page: Page;
  prompt: string;
}): Promise<boolean> {
  await focusTerminalInput(options.page);
  await options.page.keyboard.type(options.prompt, { delay: 25 });
  await options.page.keyboard.press("Enter");

  return await waitForPromptAccepted({
    apiUrl: options.apiUrl,
    baselineMessageIds: options.baselineMessageIds,
    baselineSession: options.baselineSession,
    cellId: options.cellId,
    prompt: options.prompt,
    timeoutMs: SEND_ATTEMPT_TIMEOUT_MS - SEND_API_TIMEOUT_MS,
  });
}

async function waitForPromptAccepted(options: {
  apiUrl: string;
  baselineMessageIds: ReadonlySet<string>;
  baselineSession: AgentSession;
  cellId: string;
  prompt: string;
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
        if (!currentSession) {
          return false;
        }

        const sessionChanged =
          currentSession.updatedAt !== options.baselineSession.updatedAt ||
          currentSession.status !== options.baselineSession.status;

        if (sessionChanged) {
          promptAccepted = true;
          return true;
        }

        const messages = await fetchAgentMessages(
          options.apiUrl,
          currentSession.id
        );
        const userMessageAccepted = messages.some(
          (message) =>
            !options.baselineMessageIds.has(message.id) &&
            message.role === "user" &&
            Boolean(message.content?.includes(options.prompt))
        );

        if (userMessageAccepted) {
          promptAccepted = true;
        }

        return userMessageAccepted;
      },
      errorMessage: "Prompt did not create a user message or change session",
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
  cellId: string;
  page: Page;
  timeoutMs: number;
}): Promise<void> {
  let restartCount = 0;
  let observedAssistantOutput = false;
  let lastConnectionState = "unknown";
  let lastSessionStatus = "unknown";

  await waitForCondition({
    check: async () => {
      const currentSession = await fetchAgentSession(
        options.apiUrl,
        options.cellId
      );

      if (!currentSession) {
        return false;
      }

      lastSessionStatus = currentSession.status;

      const messages = await fetchAgentMessages(
        options.apiUrl,
        currentSession.id
      );
      const latestAssistantMessage = findLatestAssistantMessage(
        messages,
        options.baselineMessageIds
      );

      if (latestAssistantMessage?.content?.trim()) {
        observedAssistantOutput = true;
      }

      if (
        observedAssistantOutput &&
        currentSession.status === "awaiting_input"
      ) {
        return true;
      }

      const connectionState = await options.page
        .locator(selectors.terminalConnectionBadge)
        .getAttribute("data-connection-state");
      lastConnectionState = connectionState ?? "unknown";

      const recovery = await maybeRecoverTerminalDuringAssistantWait({
        connectionState,
        observedAssistantOutput,
        page: options.page,
        restartCount,
      });
      restartCount = recovery.restartCount;
      if (recovery.shouldResolve) {
        return true;
      }

      return false;
    },
    errorMessage: `Agent response was not observed after sending prompt. state=${lastConnectionState} session=${lastSessionStatus} assistantOutput=${String(observedAssistantOutput)} restarts=${String(restartCount)}`,
    intervalMs: 1000,
    timeoutMs: options.timeoutMs,
  });
}

async function maybeRecoverTerminalDuringAssistantWait(options: {
  connectionState: string | null;
  observedAssistantOutput: boolean;
  page: Page;
  restartCount: number;
}): Promise<{ shouldResolve: boolean; restartCount: number }> {
  if (
    options.connectionState !== "exited" &&
    options.connectionState !== "disconnected"
  ) {
    return {
      shouldResolve: false,
      restartCount: options.restartCount,
    };
  }

  if (options.observedAssistantOutput) {
    return {
      shouldResolve: true,
      restartCount: options.restartCount,
    };
  }

  if (options.restartCount < 1) {
    await options.page.locator(selectors.terminalRestartButton).click();
    await options.page.waitForTimeout(TERMINAL_RECOVERY_WAIT_MS);
    return {
      shouldResolve: false,
      restartCount: options.restartCount + 1,
    };
  }

  return {
    shouldResolve: false,
    restartCount: options.restartCount,
  };
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

async function assertSessionModelSelection(options: {
  apiUrl: string;
  cellId: string;
  expectedModelId: string;
  expectedProviderId: string;
}): Promise<void> {
  let observedModelId = "unknown";
  let observedProviderId = "unknown";

  await waitForCondition({
    check: async () => {
      const session = await fetchAgentSession(options.apiUrl, options.cellId);
      if (!session) {
        return false;
      }

      observedModelId = session.modelId ?? "none";
      observedProviderId =
        session.modelProviderId ?? session.provider ?? "none";

      return (
        session.modelId === options.expectedModelId &&
        observedProviderId === options.expectedProviderId
      );
    },
    errorMessage: `Agent session model mismatch. expected=${options.expectedProviderId}/${options.expectedModelId} observed=${observedProviderId}/${observedModelId}`,
    timeoutMs: SESSION_UPDATE_TIMEOUT_MS,
  });
}

async function sendPrompt(options: {
  apiUrl: string;
  cellId: string;
  page: Page;
  prompt: string;
}): Promise<void> {
  const response = await fetch(
    `${options.apiUrl}/api/cells/${options.cellId}/chat/terminal/input`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: `${options.prompt}\n` }),
    }
  );

  if (response.ok) {
    return;
  }

  await focusTerminalInput(options.page);
  await options.page.keyboard.type(options.prompt, { delay: 25 });
  await options.page.keyboard.press("Enter");
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
