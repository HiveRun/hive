import { type Page, test } from "@playwright/test";
import {
  launchDesktopApp,
  navigateInDesktopApp,
  readDesktopDiagnostics,
} from "./utils/desktop-app";

const CHAT_ROUTE_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 500;
const SESSION_TIMEOUT_MS = 60_000;
const PROMPT_ACCEPTED_TIMEOUT_MS = 30_000;
const SEND_ATTEMPTS = 3;
const SEND_RETRY_DELAY_MS = 1000;
const TERMINAL_OUTPUT_SELECTOR = '[data-testid="cell-terminal"]';

test("desktop cell chat smoke creates a cell and accepts a prompt", async () => {
  const apiUrl = resolveApiUrl();
  const { app, page } = await launchDesktopApp();

  try {
    const cellId = await createCellViaApi({
      apiUrl,
      name: `Desktop E2E Cell ${Date.now()}`,
    });

    await navigateInDesktopApp(page, `/cells/${cellId}/chat`);
    await waitForReadyChatRoute({ page, apiUrl, cellId });

    const prompt = `Desktop chat token ${Date.now()}`;
    await sendPromptUntilAccepted({ apiUrl, cellId, page, prompt });
  } finally {
    await app.close();
  }
});

function resolveApiUrl() {
  const apiUrl = process.env.HIVE_E2E_API_URL;
  if (!apiUrl) {
    throw new Error("HIVE_E2E_API_URL is required for desktop smoke tests");
  }
  return apiUrl;
}

async function createCellViaApi(options: { apiUrl: string; name: string }) {
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

  return payload.id as string;
}

async function resolveWorkspaceId(apiUrl: string) {
  const response = await fetch(`${apiUrl}/api/workspaces`);
  if (!response.ok) {
    throw new Error(`Failed to fetch workspaces: ${response.status}`);
  }

  const payload = await response.json();
  const active = payload?.activeWorkspaceId as string | null;
  if (active) {
    return active;
  }

  const firstWorkspace = payload?.workspaces?.[0]?.id as string | undefined;
  if (!firstWorkspace) {
    throw new Error("No workspace available for desktop smoke test");
  }

  return firstWorkspace;
}

async function waitForReadyChatRoute(options: {
  page: Page;
  apiUrl: string;
  cellId: string;
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < CHAT_ROUTE_TIMEOUT_MS) {
    const cell = await fetchCellDetail(options.apiUrl, options.cellId);
    if (cell?.status === "error") {
      throw new Error(
        `Cell ${options.cellId} failed during provisioning: ${cell.lastSetupError ?? "setup failed"}`
      );
    }

    if (cell?.status === "ready") {
      const path = new URL(options.page.url()).pathname;
      if (path !== `/cells/${options.cellId}/chat`) {
        await navigateInDesktopApp(
          options.page,
          `/cells/${options.cellId}/chat`
        );
      }
      return;
    }

    await wait(POLL_INTERVAL_MS);
  }

  const diagnostics = await readDesktopDiagnostics(options.page);
  throw new Error(
    `Timed out waiting for cell ${options.cellId} chat readiness. ${JSON.stringify(diagnostics)}`
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

async function fetchSession(apiUrl: string, cellId: string) {
  const response = await fetch(
    `${apiUrl}/api/agents/sessions/byCell/${cellId}`
  );
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload?.session ?? null;
}

async function waitForSession(apiUrl: string, cellId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SESSION_TIMEOUT_MS) {
    const session = await fetchSession(apiUrl, cellId);
    if (session?.id) {
      return session as { id: string; updatedAt?: string; status?: string };
    }
    await wait(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for agent session for cell ${cellId}`);
}

async function fetchSessionMessages(apiUrl: string, sessionId: string) {
  const response = await fetch(
    `${apiUrl}/api/agents/sessions/${sessionId}/messages`
  );
  if (!response.ok) {
    return [] as Array<{ id: string; role: string; content?: string }>;
  }

  const payload = await response.json();
  return (payload?.messages ?? []) as Array<{
    id: string;
    role: string;
    content?: string;
  }>;
}

async function sendPromptUntilAccepted(options: {
  apiUrl: string;
  cellId: string;
  page: Page;
  prompt: string;
}) {
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    const session = await waitForSession(options.apiUrl, options.cellId);
    const baselineMessages = await fetchSessionMessages(
      options.apiUrl,
      session.id
    );
    const baselineMessageIds = new Set(
      baselineMessages.map((message) => message.id)
    );

    await sendPromptViaApi(options);

    const accepted = await waitForPromptAccepted({
      apiUrl: options.apiUrl,
      cellId: options.cellId,
      page: options.page,
      prompt: options.prompt,
      baselineSessionUpdatedAt: session.updatedAt,
      baselineMessageIds,
    });

    if (accepted) {
      return;
    }

    await wait(SEND_RETRY_DELAY_MS);
  }

  throw new Error("Prompt was not accepted by the agent session");
}

async function sendPromptViaApi(options: {
  apiUrl: string;
  cellId: string;
  prompt: string;
}) {
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

async function waitForPromptAccepted(options: {
  apiUrl: string;
  cellId: string;
  page: Page;
  prompt: string;
  baselineSessionUpdatedAt?: string;
  baselineMessageIds: Set<string>;
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < PROMPT_ACCEPTED_TIMEOUT_MS) {
    const sessionResponse = await fetch(
      `${options.apiUrl}/api/agents/sessions/byCell/${options.cellId}`
    );
    if (!sessionResponse.ok) {
      await wait(POLL_INTERVAL_MS);
      continue;
    }

    const sessionPayload = await sessionResponse.json();
    const session = sessionPayload?.session as
      | { id?: string; updatedAt?: string }
      | undefined;
    const sessionId = session?.id;
    if (!sessionId) {
      await wait(POLL_INTERVAL_MS);
      continue;
    }

    if (
      typeof session.updatedAt === "string" &&
      session.updatedAt !== options.baselineSessionUpdatedAt
    ) {
      return true;
    }

    const messagesResponse = await fetch(
      `${options.apiUrl}/api/agents/sessions/${sessionId}/messages`
    );
    if (!messagesResponse.ok) {
      await wait(POLL_INTERVAL_MS);
      continue;
    }

    const messagesPayload = await messagesResponse.json();
    const messages = (messagesPayload?.messages ?? []) as Array<{
      id: string;
      role: string;
      content?: string;
    }>;

    const found = messages.some(
      (message) =>
        !options.baselineMessageIds.has(message.id) &&
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.includes(options.prompt)
    );

    if (found) {
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

async function isPromptVisibleInTerminal(page: Page, prompt: string) {
  const terminal = page.locator(TERMINAL_OUTPUT_SELECTOR).first();
  try {
    if (!(await terminal.isVisible())) {
      return false;
    }

    const terminalText = await terminal.innerText();
    return terminalText.includes(prompt);
  } catch {
    return false;
  }
}

async function wait(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
