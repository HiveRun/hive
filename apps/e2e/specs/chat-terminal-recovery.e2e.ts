import { expect, type Page, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCell,
  ensureTerminalReady,
  sendChatTerminalPrompt,
  waitForCellStatus,
  waitForChatRoute,
  waitForCondition,
} from "../src/test-helpers";

const TERMINAL_READY_TIMEOUT_MS = 120_000;
const CHAT_ROUTE_TIMEOUT_MS = 180_000;
const CONNECTION_TRANSITION_TIMEOUT_MS = 30_000;
const POST_RESTART_INPUT_TIMEOUT_MS = 30_000;
const SESSION_UPDATE_TIMEOUT_MS = 120_000;
const PID_PATTERN = /pid\s+(\d+)/i;
const CHAT_TEMPLATE_LABEL = "Basic Template";

type AgentSession = {
  id: string;
  status: string;
};

type AgentMessage = {
  id: string;
  role: string;
  content?: string;
};

type AgentMessageListResponse = {
  messages: AgentMessage[];
};

type RpcResult<T> = {
  success: boolean;
  data: T;
};

test.describe("chat terminal recovery", () => {
  test("recovers from a terminated chat terminal process", async ({ page }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `E2E Chat Recovery ${Date.now()}`,
      templateLabel: CHAT_TEMPLATE_LABEL,
    });

    await waitForCellStatus({
      apiUrl,
      cellId,
      status: "ready",
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await page.goto(`/cells/${cellId}/chat`);
    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });
    await ensureTerminalReady(page, {
      context: "chat terminal initial load",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const pid = await readTerminalPid(page);
    if (pid !== null) {
      killTerminalPid(pid);

      await waitForCondition({
        timeoutMs: CONNECTION_TRANSITION_TIMEOUT_MS,
        errorMessage:
          "Chat terminal did not report exited/disconnected after kill",
        check: async () => {
          const state = await page
            .locator(selectors.terminalConnectionBadge)
            .getAttribute("data-connection-state");
          return state === "exited" || state === "disconnected";
        },
      });
    }

    await page.locator(selectors.terminalRestartButton).click();
    await ensureTerminalReady(page, {
      context: "chat terminal after restart",
      timeoutMs: TERMINAL_READY_TIMEOUT_MS,
    });

    const session = await waitForAgentSession(apiUrl, cellId);
    const baselineMessages = await fetchAgentMessages(apiUrl, session.id);
    const baselineMessageIds = new Set(
      baselineMessages.map((message) => message.id)
    );
    const prompt = `E2E recovery token ${Date.now()}`;

    await sendChatTerminalPrompt(page, prompt);

    await waitForCondition({
      timeoutMs: POST_RESTART_INPUT_TIMEOUT_MS,
      errorMessage: "Chat terminal did not accept input after restart",
      check: async () => {
        const messages = await fetchAgentMessages(apiUrl, session.id);
        return messages.some(
          (message) =>
            !baselineMessageIds.has(message.id) &&
            message.role === "user" &&
            Boolean(message.content?.includes(prompt))
        );
      },
    });

    await expect(
      page.locator(selectors.terminalConnectionBadge)
    ).toHaveAttribute("data-connection-state", "online");
  });
});

async function readTerminalPid(page: Page): Promise<number | null> {
  const text = await page.locator(selectors.terminalRoot).innerText();
  const match = text.match(PID_PATTERN);
  if (!match?.[1]) {
    return null;
  }

  return Number(match[1]);
}

async function waitForAgentSession(
  apiUrl: string,
  cellId: string
): Promise<AgentSession> {
  await waitForCondition({
    timeoutMs: SESSION_UPDATE_TIMEOUT_MS,
    errorMessage: `Agent session was not available for cell ${cellId}`,
    check: async () => Boolean(await fetchAgentSession(apiUrl, cellId)),
  });

  const session = await fetchAgentSession(apiUrl, cellId);
  if (!session) {
    throw new Error(`Agent session missing for cell ${cellId}`);
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
    fields: ["id", "status"],
  });

  if (!(payload.success && payload.data.id)) {
    return null;
  }

  return payload.data as AgentSession;
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

function killTerminalPid(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code !== "ESRCH") {
      throw error;
    }
  }
}
