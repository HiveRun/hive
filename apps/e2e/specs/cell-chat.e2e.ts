import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  createApiCellAndOpenChat,
  ensureTerminalReady,
  fetchAgentMessageIds,
  fetchAgentMessages,
  fetchAgentSession,
  focusTerminalInput,
  requireApiUrl,
  waitForAgentSession,
  waitForChatRoute,
  waitForCondition,
} from "../src/test-helpers";

const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_ROUTE_TIMEOUT_MS = 180_000;
const TERMINAL_READY_TIMEOUT_MS = 120_000;
const TERMINAL_INPUT_READY_TIMEOUT_MS = 30_000;
const SESSION_UPDATE_TIMEOUT_MS = 120_000;
const SEND_ATTEMPT_TIMEOUT_MS = 20_000;
const POST_RESPONSE_VIDEO_SETTLE_MS = 500;
const TERMINAL_INPUT_FOCUS_TIMEOUT_MS = 10_000;
const CELL_TEMPLATE_LABEL = "E2E Template";
const EXPECTED_MODEL_ID = "big-pickle";
const EXPECTED_MODEL_PROVIDER_ID = "opencode";
const PROVISIONING_TIMELINE_TEXT = /Provisioning timeline/i;

test.describe("cell chat flow", () => {
  test("creates a cell and sends a chat message", async ({
    page,
  }, testInfo) => {
    const apiUrl = requireApiUrl();

    const { cellId, initialRoute } = await createApiCellAndOpenChat({
      page,
      apiUrl,
      name: `E2E Cell ${Date.now()}`,
      templateLabel: CELL_TEMPLATE_LABEL,
      initialRouteTimeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });
    if (initialRoute === "provisioning") {
      await expect(page.getByText(PROVISIONING_TIMELINE_TEXT)).toBeVisible();
    }

    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await ensureTerminalReady(page, {
      context: "before prompt send",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    await assertSessionModelSelection({
      apiUrl,
      cellId,
      expectedModelId: EXPECTED_MODEL_ID,
      expectedProviderId: EXPECTED_MODEL_PROVIDER_ID,
    });

    const token = Date.now();
    const multilinePrompt = `E2E accepted message ${token}.\nSecond line marker E2E_MULTILINE_${token}.`;

    await sendMultilinePromptViaKeyboard({
      apiUrl,
      cellId,
      page,
      prompt: multilinePrompt,
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

async function sendMultilinePromptViaKeyboard(options: {
  apiUrl: string;
  cellId: string;
  page: Page;
  prompt: string;
}): Promise<void> {
  const baselineSession = await waitForAgentSession({
    apiUrl: options.apiUrl,
    cellId: options.cellId,
    timeoutMs: SESSION_UPDATE_TIMEOUT_MS,
  });
  const baselineMessageIds = await fetchAgentMessageIds(
    options.apiUrl,
    baselineSession.id
  );
  const [firstLine = "", secondLine = ""] = options.prompt.split("\n");

  await ensureTerminalReady(options.page, {
    context: "before multiline prompt send",
    timeoutMs: TERMINAL_INPUT_READY_TIMEOUT_MS,
  });
  await focusTerminalInput(options.page, TERMINAL_INPUT_FOCUS_TIMEOUT_MS);
  await options.page.keyboard.type(firstLine, { delay: 25 });
  await options.page.keyboard.press("Shift+Enter");
  await options.page.keyboard.type(secondLine, { delay: 25 });
  await options.page.keyboard.press("Enter");

  await waitForUserMessageAccepted({
    apiUrl: options.apiUrl,
    baselineMessageIds,
    sessionId: baselineSession.id,
    prompt: options.prompt,
    timeoutMs: SEND_ATTEMPT_TIMEOUT_MS,
  });
  await options.page.waitForTimeout(POST_RESPONSE_VIDEO_SETTLE_MS);
}

async function waitForUserMessageAccepted(options: {
  apiUrl: string;
  baselineMessageIds: ReadonlySet<string>;
  sessionId: string;
  prompt: string;
  timeoutMs: number;
}): Promise<void> {
  await waitForCondition({
    check: async () => {
      const messages = await fetchAgentMessages(
        options.apiUrl,
        options.sessionId
      );
      return messages.some(
        (message) =>
          !options.baselineMessageIds.has(message.id) &&
          message.role === "user" &&
          Boolean(message.content?.includes(options.prompt))
      );
    },
    errorMessage: "Multiline prompt did not create one matching user message",
    intervalMs: 1000,
    timeoutMs: options.timeoutMs,
  });
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
