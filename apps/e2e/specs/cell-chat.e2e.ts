import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  E2E_MODEL_ID,
  E2E_PROVIDER_ID,
} from "../src/runtime/fixture-workspace";
import {
  createApiCellAndOpenChat,
  ensureTerminalReady,
  fetchAgentMessageIds,
  fetchAgentSession,
  focusTerminalInput,
  requireApiUrl,
  waitForAgentMessage,
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
const EXPECTED_MODEL_ID = E2E_MODEL_ID;
const EXPECTED_MODEL_PROVIDER_ID = E2E_PROVIDER_ID;
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

  await waitForAgentMessage({
    apiUrl: options.apiUrl,
    baselineMessageIds,
    cellId: options.cellId,
    content: options.prompt,
    errorMessage: "Multiline prompt did not create one matching user message",
    intervalMs: 1000,
    role: "user",
    sessionId: baselineSession.id,
    timeoutMs: SEND_ATTEMPT_TIMEOUT_MS,
  });
  await waitForAgentMessage({
    apiUrl: options.apiUrl,
    baselineMessageIds,
    cellId: options.cellId,
    content: options.prompt,
    errorMessage:
      "Multiline prompt did not produce one matching assistant response",
    intervalMs: 1000,
    role: "assistant",
    sessionId: baselineSession.id,
    timeoutMs: SESSION_UPDATE_TIMEOUT_MS,
  });
  await options.page.waitForTimeout(POST_RESPONSE_VIDEO_SETTLE_MS);
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
