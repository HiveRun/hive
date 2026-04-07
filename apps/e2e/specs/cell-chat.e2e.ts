import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCell,
  fetchAgentModels,
  fetchCell,
  fetchWorkspaces,
  waitForChatRoute,
  waitForProvisioningOrChatRoute,
} from "../src/test-helpers";

type AgentSession = {
  id: string;
  modelId?: string;
  modelProviderId?: string;
  provider?: string;
  status: string;
  updatedAt: string;
};

type RpcResult<T> = {
  success: boolean;
  data: T;
  errors?: Array<{ message?: string; shortMessage?: string }>;
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

const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_ROUTE_TIMEOUT_MS = 180_000;
const SESSION_UPDATE_TIMEOUT_MS = 120_000;
const ASSISTANT_OUTPUT_TIMEOUT_MS = 40_000;
const SEND_ATTEMPTS = 3;
const SEND_ATTEMPT_TIMEOUT_MS = 20_000;
const SEND_API_TIMEOUT_MS = 8000;
const POST_RESPONSE_VIDEO_SETTLE_MS = 500;
const POLL_INTERVAL_MS = 500;
const TERMINAL_RECOVERY_WAIT_MS = 750;
const CELL_TEMPLATE_LABEL = "Basic Template";
const PROVISIONING_TIMELINE_TEXT = /Provisioning timeline/i;

test.describe("cell chat flow", () => {
  test("creates a cell and sends a chat message", async ({
    page,
  }, testInfo) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    await assertWorkspaceVisible(page, apiUrl);

    const cellId = await createCell({
      page,
      name: `E2E Cell ${Date.now()}`,
      templateLabel: CELL_TEMPLATE_LABEL,
    });

    const cell = await fetchCell(apiUrl, cellId);
    const modelsPayload = await fetchAgentModels(apiUrl, cell.workspaceId);
    const expectedProviderId =
      Object.keys(modelsPayload.defaults)[0] ??
      modelsPayload.models[0]?.provider ??
      null;
    const expectedModelId =
      (expectedProviderId
        ? modelsPayload.defaults[expectedProviderId]
        : null) ??
      modelsPayload.models.find(
        (model) => model.provider === expectedProviderId
      )?.id ??
      modelsPayload.models[0]?.id ??
      null;

    if (!(expectedProviderId && expectedModelId)) {
      throw new Error(
        "Could not determine expected model selection for strict chat E2E"
      );
    }

    await page.goto(`/cells/${cellId}/chat`);

    const initialRoute = await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });
    if (initialRoute === "provisioning") {
      await expect(page.getByText(PROVISIONING_TIMELINE_TEXT)).toBeVisible();
    }

    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await assertSessionModelSelection({
      apiUrl,
      cellId,
      expectedModelId,
      expectedProviderId,
    });

    await expect(page.locator(selectors.terminalRoot).first()).toBeVisible();

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
      expectedModelId,
      expectedProviderId,
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
  const payload = await rpcRun<Partial<AgentSession>>(apiUrl, {
    action: "get_agent_session_by_cell",
    input: { cellId },
    fields: [
      "id",
      "modelId",
      "modelProviderId",
      "provider",
      "status",
      "updatedAt",
    ],
  });

  if (!(payload.success && payload.data.id)) {
    return null;
  }

  return payload.data as AgentSession;
}

async function rpcRun<T>(
  apiUrl: string,
  payload: Record<string, unknown>
): Promise<RpcResult<T>> {
  const response = await fetch(`${apiUrl}/rpc/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}`);
  }

  return (await response.json()) as RpcResult<T>;
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
    const baselineMessages = await fetchAgentMessages(
      options.apiUrl,
      baselineSession.id
    );
    const baselineMessageIds = new Set(
      baselineMessages.map((message) => message.id)
    );
    const baselineOutputSeq = await readTerminalOutputSeq(options.page);

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
          baselineOutputSeq,
          sessionId: baselineSession.id,
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

async function assertWorkspaceVisible(
  page: Page,
  apiUrl: string
): Promise<void> {
  const workspaces = await fetchWorkspaces(apiUrl);
  const activeWorkspace =
    workspaces.workspaces.find(
      (workspace) => workspace.id === workspaces.activeWorkspaceId
    ) ?? workspaces.workspaces[0];

  if (!activeWorkspace) {
    throw new Error("No workspace available for chat E2E");
  }

  await expect(
    page
      .locator(selectors.workspaceSection)
      .filter({ hasText: activeWorkspace.label })
      .first()
  ).toBeVisible();
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
  baselineOutputSeq: number;
  sessionId: string;
  page: Page;
  timeoutMs: number;
}): Promise<void> {
  let restartCount = 0;
  let observedAssistantOutput = false;
  let lastConnectionState = "unknown";

  await waitForCondition({
    check: async () => {
      const messages = await fetchAgentMessages(
        options.apiUrl,
        options.sessionId
      );
      const latestAssistantMessage = findLatestAssistantMessage(
        messages,
        options.baselineMessageIds
      );

      if (latestAssistantMessage?.content?.trim()) {
        observedAssistantOutput = true;
      }

      const outputSeq = await readTerminalOutputSeq(options.page);

      if (!observedAssistantOutput && outputSeq > options.baselineOutputSeq) {
        observedAssistantOutput = true;
      }

      if (observedAssistantOutput && latestAssistantMessage?.content?.trim()) {
        return true;
      }

      const connectionState = await options.page
        .locator(selectors.terminalConnectionBadge)
        .getAttribute("data-connection-state")
        .catch(() => null);
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
    errorMessage: `Agent response was not observed after sending prompt. state=${lastConnectionState} assistantOutput=${String(observedAssistantOutput)} restarts=${String(restartCount)}`,
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
  cellId: string;
  page: Page;
  prompt: string;
}): Promise<void> {
  await focusTerminalInput(options.page);
  await options.page.keyboard.type(options.prompt, { delay: 25 });
  await waitForCondition({
    timeoutMs: 30_000,
    errorMessage: "Buffered chat draft was not visible before pressing Enter",
    check: async () => {
      const draftLength = await options.page
        .getByTestId("cell-terminal")
        .getAttribute("data-terminal-draft-length")
        .catch(() => null);

      return Number(draftLength ?? "0") > 0;
    },
  });
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

async function readTerminalOutputSeq(page: Page): Promise<number> {
  const raw = await page
    .locator(selectors.terminalRoot)
    .first()
    .getAttribute("data-terminal-output-seq")
    .catch(() => null);

  return Number(raw ?? "0");
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
