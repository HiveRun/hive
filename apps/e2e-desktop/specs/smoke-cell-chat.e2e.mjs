import { $, browser } from "@wdio/globals";

const describe = globalThis.describe;
const it = globalThis.it;

if (typeof describe !== "function" || typeof it !== "function") {
  throw new Error("Mocha globals are not available in this WDIO worker");
}

const SESSION_TIMEOUT_MS = 120_000;
const TERMINAL_READY_TIMEOUT_MS = 120_000;
const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_ROUTE_TIMEOUT_MS = 240_000;
const PROMPT_ACCEPT_TIMEOUT_MS = 20_000;
const SEND_API_TIMEOUT_MS = 8000;
const SEND_ATTEMPTS = 3;
const MAX_TERMINAL_RESTARTS = 2;
const POLL_INTERVAL_MS = 500;
const TERMINAL_RECOVERY_WAIT_MS = 750;

const terminalSelectors = {
  connectionBadge: "[data-testid='terminal-connection']",
  restartButton: "[data-testid='terminal-restart-button']",
  terminalRoot: "[data-testid='cell-terminal']",
  inputSurface: "[data-testid='cell-terminal-input']",
  inputTextarea: "[data-testid='cell-terminal-input'] .xterm-helper-textarea",
};

describe("desktop cell chat smoke", () => {
  it("creates a cell and accepts a chat prompt", async () => {
    const apiUrl = resolveApiUrl();
    const cellId = await createCellViaApi({
      apiUrl,
      name: `Desktop E2E Cell ${Date.now()}`,
    });

    await browser.url(`/cells/${cellId}/chat`);
    await waitForProvisioningOrChatRoute({
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });
    await waitForChatRoute({
      apiUrl,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await ensureTerminalReady({
      context: "before prompt send",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const prompt = `Desktop chat token ${Date.now()}`;
    await sendPromptWithRetries({
      apiUrl,
      cellId,
      prompt,
    });

    await ensureTerminalReady({
      context: "after prompt send",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });
  });
});

function resolveApiUrl() {
  const apiUrl = process.env.HIVE_E2E_API_URL;
  if (!apiUrl) {
    throw new Error("HIVE_E2E_API_URL is required for desktop smoke tests");
  }
  return apiUrl;
}

async function createCellViaApi(options) {
  const workspaceId = await resolveWorkspaceId(options.apiUrl);
  const response = await fetch(`${options.apiUrl}/api/cells`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: options.name,
      templateId: "e2e-template",
      workspaceId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create desktop smoke cell: ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.message) {
    throw new Error(payload.message);
  }
  if (!payload?.id) {
    throw new Error("Desktop smoke cell response missing id");
  }

  return payload.id;
}

async function resolveWorkspaceId(apiUrl) {
  const response = await fetch(`${apiUrl}/api/workspaces`);
  if (!response.ok) {
    throw new Error(`Failed to fetch workspaces: ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.message) {
    throw new Error(payload.message);
  }

  const active = payload?.activeWorkspaceId ?? null;
  if (active) {
    return active;
  }

  const firstWorkspace = payload?.workspaces?.[0]?.id;
  if (!firstWorkspace) {
    throw new Error("No workspace available for desktop smoke test");
  }

  return firstWorkspace;
}

async function sendPromptWithRetries(options) {
  let baselineSession = await waitForSession(options.apiUrl, options.cellId);

  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    await ensureTerminalReady({
      context: `send attempt ${String(attempt)}`,
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const baselineMessages = await fetchSessionMessages({
      apiUrl: options.apiUrl,
      sessionId: baselineSession.id,
    });
    const baselineMessageIds = new Set(
      baselineMessages.map((message) => message.id)
    );

    await sendPromptViaApi(options);

    const acceptedAfterApiWrite = await waitForPromptAccepted({
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
          apiUrl: options.apiUrl,
          cellId: options.cellId,
          baselineSession,
          baselineMessageIds,
          prompt: options.prompt,
          timeoutMs: PROMPT_ACCEPT_TIMEOUT_MS - SEND_API_TIMEOUT_MS,
        });

    if (promptAccepted) {
      return;
    }

    baselineSession = await waitForSession(options.apiUrl, options.cellId);
  }

  throw new Error("Prompt was not accepted after retries");
}

async function sendPromptViaKeyboardAndWait(options) {
  await focusTerminalInput();
  await browser.keys(options.prompt);
  await browser.keys("Enter");

  return await waitForPromptAccepted({
    apiUrl: options.apiUrl,
    cellId: options.cellId,
    baselineSession: options.baselineSession,
    baselineMessageIds: options.baselineMessageIds,
    prompt: options.prompt,
    timeoutMs: options.timeoutMs,
  });
}

async function waitForPromptAccepted(options) {
  let promptAccepted = false;

  try {
    await waitForCondition({
      timeoutMs: options.timeoutMs,
      check: async () => {
        const currentSession = await fetchSession({
          apiUrl: options.apiUrl,
          cellId: options.cellId,
        });
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

        const messages = await fetchSessionMessages({
          apiUrl: options.apiUrl,
          sessionId: currentSession.id,
        });

        const userMessageAccepted = messages.some(
          (message) =>
            !options.baselineMessageIds.has(message.id) &&
            message.role === "user" &&
            typeof message.content === "string" &&
            message.content.includes(options.prompt)
        );

        if (userMessageAccepted) {
          promptAccepted = true;
        }

        return userMessageAccepted;
      },
      errorMessage: "Prompt did not create a user message or change session",
      intervalMs: 1000,
    });

    return promptAccepted;
  } catch {
    return false;
  }
}

async function focusTerminalInput() {
  const surface = await $(terminalSelectors.inputSurface);
  const textarea = await $(terminalSelectors.inputTextarea);

  await surface.click();
  await textarea.click();

  await waitForCondition({
    timeoutMs: 10_000,
    errorMessage: "Terminal input textarea did not receive focus",
    check: async () =>
      await browser.execute(() => {
        const active = document.activeElement;
        return active?.classList.contains("xterm-helper-textarea") ?? false;
      }),
  });
}

async function ensureTerminalReady(options) {
  let restartCount = 0;
  let lastState = "unknown";

  await waitForCondition({
    timeoutMs: options.timeoutMs,
    errorMessage: `Terminal not ready during ${options.context}. lastState=${lastState} restarts=${String(restartCount)}`,
    check: async () => {
      const connectionBadge = await $(terminalSelectors.connectionBadge);
      if (!(await connectionBadge.isExisting())) {
        return false;
      }

      const state = await connectionBadge.getAttribute("data-connection-state");
      lastState = state ?? "unknown";

      if (state === "online") {
        const terminalRoot = await $(terminalSelectors.terminalRoot);
        if (!(await terminalRoot.isExisting())) {
          return false;
        }

        const inputSurface = await $(terminalSelectors.inputSurface);
        return await inputSurface.isDisplayed();
      }

      if (state === "exited" || state === "disconnected") {
        if (restartCount >= MAX_TERMINAL_RESTARTS) {
          throw new Error(
            `Terminal stayed ${state} during ${options.context} after ${String(MAX_TERMINAL_RESTARTS)} restarts`
          );
        }

        const restartButton = await $(terminalSelectors.restartButton);
        await restartButton.click();
        restartCount += 1;
        await wait(TERMINAL_RECOVERY_WAIT_MS);
      }

      return false;
    },
  });
}

async function waitForSession(apiUrl, cellId) {
  let latestSession = null;

  await waitForCondition({
    timeoutMs: SESSION_TIMEOUT_MS,
    errorMessage: "Agent session did not become available for cell",
    check: async () => {
      latestSession = await fetchSession({ apiUrl, cellId });
      return Boolean(latestSession);
    },
  });

  if (!latestSession) {
    throw new Error("Agent session missing after successful wait");
  }

  return latestSession;
}

async function fetchSession(options) {
  const response = await fetch(
    `${options.apiUrl}/api/agents/sessions/byCell/${options.cellId}`
  );
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload?.session ?? null;
}

async function fetchSessionMessages(options) {
  const response = await fetch(
    `${options.apiUrl}/api/agents/sessions/${options.sessionId}/messages`
  );
  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return payload?.messages ?? [];
}

async function sendPromptViaApi(options) {
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

  if (!response.ok) {
    throw new Error(
      `Failed to send desktop smoke prompt to cell ${options.cellId}: ${response.status}`
    );
  }
}

async function waitForCondition(options) {
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

async function wait(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForProvisioningOrChatRoute(options) {
  let resolvedRoute = null;

  await waitForCondition({
    timeoutMs: options.timeoutMs,
    errorMessage: `Cell ${options.cellId} did not reach chat/provisioning route`,
    check: async () => {
      const url = await browser.getUrl();
      resolvedRoute = resolveCellSubroute(url, options.cellId);
      return resolvedRoute !== null;
    },
  });

  if (!resolvedRoute) {
    throw new Error(
      `Failed to resolve initial route for cell ${options.cellId}`
    );
  }

  return resolvedRoute;
}

async function waitForChatRoute(options) {
  let lastPath = "unknown";
  let lastStatus = "unknown";

  await waitForCondition({
    timeoutMs: options.timeoutMs,
    errorMessage: `Cell ${options.cellId} did not reach chat route. lastPath=${lastPath} lastStatus=${lastStatus}`,
    check: async () => {
      const cell = await fetchCellDetail({
        apiUrl: options.apiUrl,
        cellId: options.cellId,
      });

      lastStatus = cell?.status ?? "unknown";

      if (cell?.status === "error") {
        throw new Error(
          `Cell ${options.cellId} entered error status while waiting for chat route: ${cell.lastSetupError ?? "setup failed"}`
        );
      }

      const url = await browser.getUrl();
      const path = readPathname(url);
      lastPath = path;

      if (
        path === `/cells/${options.cellId}/chat` &&
        cell?.status === "ready"
      ) {
        return true;
      }

      if (cell?.status !== "ready") {
        return false;
      }

      await browser.url(`/cells/${options.cellId}/chat`);
      return false;
    },
  });
}

async function fetchCellDetail(options) {
  const response = await fetch(
    `${options.apiUrl}/api/cells/${options.cellId}?includeSetupLog=false`
  );
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  if (payload?.message) {
    return null;
  }

  return payload;
}

function resolveCellSubroute(url, cellId) {
  const pathname = readPathname(url);
  if (pathname === `/cells/${cellId}/chat`) {
    return "chat";
  }
  if (pathname === `/cells/${cellId}/provisioning`) {
    return "provisioning";
  }

  return null;
}

function readPathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
