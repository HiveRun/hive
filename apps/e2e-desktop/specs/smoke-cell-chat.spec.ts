import { type Locator, type Page, test } from "@playwright/test";
import {
  fetchAgentMessageIds,
  fetchAgentMessages,
  fetchAgentSession,
  type AgentSession as SessionSnapshot,
  sendChatTerminalInput,
  wait,
  waitForAgentSession,
  waitForCondition,
} from "../../e2e/src/test-helpers";
import {
  launchDesktopApp,
  navigateInDesktopApp,
  readDesktopDiagnostics,
} from "./utils/desktop-app";
import {
  createDesktopCell,
  resolveDesktopApiUrl,
} from "./utils/desktop-test-helpers";

const SESSION_TIMEOUT_MS = 120_000;
const TERMINAL_READY_TIMEOUT_MS = 120_000;
const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_ROUTE_TIMEOUT_MS = 240_000;
const PROMPT_ACCEPT_TIMEOUT_MS = 20_000;
const SEND_API_TIMEOUT_MS = 8000;
const KEYBOARD_ACCEPT_TIMEOUT_MS =
  PROMPT_ACCEPT_TIMEOUT_MS - SEND_API_TIMEOUT_MS;
const SEND_ATTEMPTS = 3;
const SEND_RETRY_DELAY_MS = 1000;
const MAX_TERMINAL_RESTARTS = 2;
const POLL_INTERVAL_MS = 500;
const TERMINAL_RECOVERY_WAIT_MS = 750;
const CHAT_ERROR_SUMMARY_LINES = 6;
const TERMINAL_MISSING_RELOAD_THRESHOLD = 20;
const MAX_TERMINAL_PAGE_RELOADS = 2;
const TERMINAL_PAGE_RELOAD_WAIT_MS = 1500;
const TERMINAL_INPUT_FOCUS_TIMEOUT_MS = 10_000;

const TERMINAL_CONNECTION_BADGE_SELECTOR =
  "[data-testid='terminal-connection']";
const TERMINAL_RESTART_BUTTON_SELECTOR =
  "[data-testid='terminal-restart-button']";
const TERMINAL_ROOT_SELECTOR = "[data-testid='cell-terminal']";
const TERMINAL_INPUT_SURFACE_SELECTOR = "[data-testid='cell-terminal-input']";
const TERMINAL_INPUT_TEXTAREA_SELECTOR =
  "[data-testid='cell-terminal-input'] .xterm-helper-textarea";

type PromptAcceptanceOptions = {
  page: Page;
  apiUrl: string;
  cellId: string;
  baselineSession: SessionSnapshot;
  baselineMessageIds: Set<string>;
  prompt: string;
  timeoutMs: number;
};

test("desktop cell chat smoke creates a cell and accepts a prompt", async () => {
  const apiUrl = resolveDesktopApiUrl(
    "HIVE_E2E_API_URL is required for desktop smoke tests"
  );
  const { app, page } = await launchDesktopApp();

  try {
    const cellId = await createDesktopCell({
      apiUrl,
      name: `Desktop E2E Cell ${Date.now()}`,
    });

    await navigateInDesktopApp(page, `/cells/${cellId}/chat`);
    await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });
    await waitForChatRoute({
      page,
      apiUrl,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await ensureTerminalReady({
      page,
      apiUrl,
      cellId,
      context: "before prompt send",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const prompt = `Desktop chat token ${Date.now()}`;
    await sendPromptWithRetries({
      page,
      apiUrl,
      cellId,
      prompt,
    });

    await ensureTerminalReady({
      page,
      apiUrl,
      cellId,
      context: "after prompt send",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });
  } finally {
    await app.close();
  }
});

async function sendPromptWithRetries(options: {
  page: Page;
  apiUrl: string;
  cellId: string;
  prompt: string;
}) {
  let baselineSession = await waitForAgentSession({
    apiUrl: options.apiUrl,
    cellId: options.cellId,
    timeoutMs: SESSION_TIMEOUT_MS,
  });

  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    await ensureTerminalReady({
      page: options.page,
      apiUrl: options.apiUrl,
      cellId: options.cellId,
      context: `send attempt ${String(attempt)}`,
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const baselineMessageIds = await fetchAgentMessageIds(
      options.apiUrl,
      baselineSession.id
    );

    await sendPromptViaApi(options.apiUrl, options.cellId, options.prompt);

    const acceptedAfterApiWrite = await waitForPromptAccepted({
      page: options.page,
      apiUrl: options.apiUrl,
      cellId: options.cellId,
      baselineSession,
      baselineMessageIds,
      prompt: options.prompt,
      timeoutMs: SEND_API_TIMEOUT_MS,
    });

    const promptAccepted = acceptedAfterApiWrite
      ? true
      : await sendPromptViaKeyboardAndWait({
          page: options.page,
          apiUrl: options.apiUrl,
          cellId: options.cellId,
          baselineSession,
          baselineMessageIds,
          prompt: options.prompt,
          timeoutMs: KEYBOARD_ACCEPT_TIMEOUT_MS,
        });

    if (promptAccepted) {
      return;
    }

    baselineSession = await waitForAgentSession({
      apiUrl: options.apiUrl,
      cellId: options.cellId,
      timeoutMs: SESSION_TIMEOUT_MS,
    });
    await wait(SEND_RETRY_DELAY_MS);
  }

  const diagnostics = await readDesktopDiagnostics(options.page);
  throw new Error(
    `Prompt was not accepted after retries. ${JSON.stringify(diagnostics)}`
  );
}

async function sendPromptViaApi(
  apiUrl: string,
  cellId: string,
  prompt: string
) {
  const response = await sendChatTerminalInput(apiUrl, cellId, `${prompt}\n`);

  if (!response.ok) {
    throw new Error(
      `Failed to send desktop smoke prompt to cell ${cellId}: ${response.status}`
    );
  }
}

async function sendPromptViaKeyboardAndWait(options: PromptAcceptanceOptions) {
  await focusTerminalInput(options.page);
  await options.page.keyboard.type(options.prompt);
  await options.page.keyboard.press("Enter");

  return await waitForPromptAccepted({
    page: options.page,
    apiUrl: options.apiUrl,
    cellId: options.cellId,
    baselineSession: options.baselineSession,
    baselineMessageIds: options.baselineMessageIds,
    prompt: options.prompt,
    timeoutMs: options.timeoutMs,
  });
}

async function focusTerminalInput(page: Page) {
  const inputSurface = page.locator(TERMINAL_INPUT_SURFACE_SELECTOR).first();
  const inputTextarea = page.locator(TERMINAL_INPUT_TEXTAREA_SELECTOR).first();

  await inputSurface.click();
  await inputTextarea.click();

  await page.waitForFunction(
    () =>
      document.activeElement?.classList.contains("xterm-helper-textarea") ??
      false,
    { timeout: TERMINAL_INPUT_FOCUS_TIMEOUT_MS }
  );
}

async function waitForPromptAccepted(options: PromptAcceptanceOptions) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.timeoutMs) {
    const currentSession = await fetchAgentSession(
      options.apiUrl,
      options.cellId
    );
    if (!currentSession) {
      await wait(POLL_INTERVAL_MS);
      continue;
    }

    const sessionChanged =
      currentSession.updatedAt !== options.baselineSession.updatedAt ||
      currentSession.status !== options.baselineSession.status;
    if (sessionChanged) {
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
        typeof message.content === "string" &&
        message.content.includes(options.prompt)
    );
    if (userMessageAccepted) {
      return true;
    }

    const terminalOutputAccepted = await isPromptVisibleInTerminal(
      options.page,
      options.prompt
    );
    if (terminalOutputAccepted) {
      return true;
    }

    await wait(POLL_INTERVAL_MS);
  }

  return false;
}

async function ensureTerminalReady(options: {
  page: Page;
  apiUrl: string;
  cellId: string;
  context: string;
  timeoutMs: number;
}) {
  const startedAt = Date.now();
  let restartCount = 0;
  let pageReloadCount = 0;
  let missingBadgeChecks = 0;
  let lastPath = "unknown";
  let lastStatus = "unknown";
  let lastState = "unknown";

  while (Date.now() - startedAt < options.timeoutMs) {
    const routeState = await ensureChatRouteActive(
      options.page,
      options.apiUrl,
      options.cellId
    );
    lastPath = routeState.path;
    lastStatus = routeState.status;

    if (!routeState.readyForTerminal) {
      await wait(POLL_INTERVAL_MS);
      continue;
    }

    await assertNoChatLoadError(options.page);

    const evaluation = await evaluateTerminalReadiness(
      options.page,
      options.context,
      restartCount
    );
    lastState = evaluation.state;
    restartCount = evaluation.restartCount;

    if (evaluation.state === "missing" && routeState.readyForTerminal) {
      missingBadgeChecks += 1;
      if (
        missingBadgeChecks >= TERMINAL_MISSING_RELOAD_THRESHOLD &&
        pageReloadCount < MAX_TERMINAL_PAGE_RELOADS
      ) {
        await forceReloadPage(options.page);
        pageReloadCount += 1;
        missingBadgeChecks = 0;
      }
    } else {
      missingBadgeChecks = 0;
    }

    if (evaluation.ready) {
      return;
    }

    await wait(POLL_INTERVAL_MS);
  }

  const diagnostics = await readDesktopDiagnostics(options.page);
  throw new Error(
    `Terminal not ready during ${options.context}. ` +
      `lastPath=${lastPath} lastStatus=${lastStatus} lastState=${lastState} ` +
      `restarts=${String(restartCount)} reloads=${String(pageReloadCount)} ` +
      `${JSON.stringify(diagnostics)}`
  );
}

async function forceReloadPage(page: Page) {
  await page.reload();
  await wait(TERMINAL_PAGE_RELOAD_WAIT_MS);
}

async function evaluateTerminalReadiness(
  page: Page,
  context: string,
  restartCount: number
) {
  const connectionBadge = page
    .locator(TERMINAL_CONNECTION_BADGE_SELECTOR)
    .first();
  if (!(await isVisible(connectionBadge))) {
    return {
      ready: false,
      restartCount,
      state: "missing",
    };
  }

  const state =
    (await connectionBadge.getAttribute("data-connection-state")) ?? "unknown";

  if (state === "online") {
    const terminalRoot = page.locator(TERMINAL_ROOT_SELECTOR).first();
    if (!(await isVisible(terminalRoot))) {
      return {
        ready: false,
        restartCount,
        state,
      };
    }

    const inputSurface = page.locator(TERMINAL_INPUT_SURFACE_SELECTOR).first();
    return {
      ready: await isVisible(inputSurface),
      restartCount,
      state,
    };
  }

  if (state === "exited" || state === "disconnected") {
    if (restartCount >= MAX_TERMINAL_RESTARTS) {
      throw new Error(
        `Terminal stayed ${state} during ${context} ` +
          `after ${String(MAX_TERMINAL_RESTARTS)} restarts`
      );
    }

    const restartButton = page
      .locator(TERMINAL_RESTART_BUTTON_SELECTOR)
      .first();
    await restartButton.click();
    await wait(TERMINAL_RECOVERY_WAIT_MS);

    return {
      ready: false,
      restartCount: restartCount + 1,
      state,
    };
  }

  return {
    ready: false,
    restartCount,
    state,
  };
}

async function waitForProvisioningOrChatRoute(options: {
  page: Page;
  cellId: string;
  timeoutMs: number;
}) {
  let resolvedRoute: "chat" | "provisioning" | null = null;
  await waitForCondition({
    check: () => {
      resolvedRoute = resolveCellSubroute(
        readPathname(options.page.url()),
        options.cellId
      );
      return Promise.resolve(resolvedRoute !== null);
    },
    errorMessage: `Cell ${options.cellId} did not reach chat/provisioning route`,
    timeoutMs: options.timeoutMs,
  });

  return resolvedRoute;
}

async function waitForChatRoute(options: {
  page: Page;
  apiUrl: string;
  cellId: string;
  timeoutMs: number;
}) {
  const startedAt = Date.now();
  let lastPath = "unknown";
  let lastStatus = "unknown";

  while (Date.now() - startedAt < options.timeoutMs) {
    const cell = await fetchCellDetail(options.apiUrl, options.cellId);
    lastStatus = cell?.status ?? "unknown";

    if (cell?.status === "error") {
      throw new Error(
        `Cell ${options.cellId} entered error status while waiting for chat route: ` +
          `${cell.lastSetupError ?? "setup failed"}`
      );
    }

    const path = readPathname(options.page.url());
    lastPath = path;

    if (path === `/cells/${options.cellId}/chat` && cell?.status === "ready") {
      return;
    }

    if (cell?.status === "ready") {
      await navigateInDesktopApp(options.page, `/cells/${options.cellId}/chat`);
    }

    await wait(POLL_INTERVAL_MS);
  }

  const diagnostics = await readDesktopDiagnostics(options.page);
  throw new Error(
    `Cell ${options.cellId} did not reach chat route. ` +
      `lastPath=${lastPath} lastStatus=${lastStatus}. ` +
      `${JSON.stringify(diagnostics)}`
  );
}

async function fetchCellDetail(apiUrl: string, cellId: string) {
  const response = await fetch(
    `${apiUrl}/api/cells/${cellId}?includeSetupLog=false`
  );
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload?.message ? null : payload;
}

async function ensureChatRouteActive(
  page: Page,
  apiUrl: string,
  cellId: string
) {
  const cell = await fetchCellDetail(apiUrl, cellId);
  const status = (cell?.status as string | undefined) ?? "unknown";
  if (status === "error") {
    throw new Error(
      `Cell ${cellId} entered error status while waiting for terminal readiness: ` +
        `${cell?.lastSetupError ?? "setup failed"}`
    );
  }

  const path = readPathname(page.url());
  const chatPath = `/cells/${cellId}/chat`;

  if (path !== chatPath) {
    await navigateInDesktopApp(page, chatPath);
    return {
      path,
      readyForTerminal: false,
      status,
    };
  }

  return {
    path,
    readyForTerminal: status === "ready",
    status,
  };
}

async function assertNoChatLoadError(page: Page) {
  const loadErrorText = await page.evaluate((lineLimit: number) => {
    const bodyText = document.body?.innerText ?? "";
    if (!bodyText.includes("Unable to load chat")) {
      return null;
    }

    return bodyText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, lineLimit)
      .join(" | ");
  }, CHAT_ERROR_SUMMARY_LINES);

  if (loadErrorText) {
    throw new Error(`Chat UI reported load failure: ${loadErrorText}`);
  }
}

async function isPromptVisibleInTerminal(page: Page, prompt: string) {
  const terminal = page.locator(TERMINAL_ROOT_SELECTOR).first();
  if (!(await isVisible(terminal))) {
    return false;
  }

  try {
    const text = await terminal.innerText();
    return text.includes(prompt);
  } catch {
    return false;
  }
}

function resolveCellSubroute(path: string, cellId: string) {
  if (path === `/cells/${cellId}/chat`) {
    return "chat" as const;
  }

  if (path === `/cells/${cellId}/provisioning`) {
    return "provisioning" as const;
  }

  return null;
}

function readPathname(urlOrPath: string) {
  try {
    return new URL(urlOrPath).pathname;
  } catch {
    return urlOrPath;
  }
}

async function isVisible(locator: Locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}
