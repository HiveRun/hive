import { test } from "@playwright/test";
import {
  createCellViaApi,
  waitForChatRoute,
  waitForCondition,
  waitForProvisioningOrChatRoute,
} from "../src/test-helpers";

type AgentSession = {
  id: string;
  startMode?: "plan" | "build";
  currentMode?: "plan" | "build";
};

type RpcResult<T> = {
  success: boolean;
  data: T;
  errors?: Array<{ message?: string; shortMessage?: string }>;
};

const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_ROUTE_TIMEOUT_MS = 180_000;
const SESSION_MODE_TIMEOUT_MS = 120_000;
const BUILD_TRANSITION_TIMEOUT_MS = 170_000;
const PLAN_TO_BUILD_TEST_TIMEOUT_MS = 240_000;
const MODE_POLL_INTERVAL_MS = 500;
const CELL_TEMPLATE_LABEL = "E2E Template";

test.describe("plan mode @plan-mode", () => {
  test("@plan-mode defaults new cells to plan mode", async ({ page }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    const cellId = await createCellViaApi({
      apiUrl,
      name: `Plan Mode Default ${Date.now()}`,
      templateLabel: CELL_TEMPLATE_LABEL,
    });

    await page.goto(`/cells/${cellId}/chat`);

    await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });

    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await waitForSessionMode({
      apiUrl,
      cellId,
      expectedStartMode: "plan",
      expectedCurrentMode: "plan",
    });
  });

  test("@plan-mode honors explicit build start mode", async ({ page }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    const cellId = await createCellViaApi({
      apiUrl,
      name: `Build Mode Override ${Date.now()}`,
      templateLabel: CELL_TEMPLATE_LABEL,
      startMode: "build",
    });

    await page.goto(`/cells/${cellId}/chat`);

    await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });

    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await waitForSessionMode({
      apiUrl,
      cellId,
      expectedStartMode: "build",
      expectedCurrentMode: "build",
    });
  });

  test("@plan-mode transitions from plan to build during chat flow", async ({
    page,
  }) => {
    test.setTimeout(PLAN_TO_BUILD_TEST_TIMEOUT_MS);

    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    const cellId = await createCellViaApi({
      apiUrl,
      name: `Plan To Build ${Date.now()}`,
      templateLabel: CELL_TEMPLATE_LABEL,
    });

    await page.goto(`/cells/${cellId}/chat`);

    await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });

    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await waitForSessionMode({
      apiUrl,
      cellId,
      expectedStartMode: "plan",
      expectedCurrentMode: "plan",
    });

    const session = await fetchAgentSession(apiUrl, cellId);
    if (!session) {
      throw new Error(`Missing session for cell ${cellId}`);
    }

    await updateSessionMode({
      apiUrl,
      sessionId: session.id,
      mode: "build",
    });

    await waitForPlanToBuildTransition({
      apiUrl,
      cellId,
      expectedCurrentMode: "build",
    });
  });
});

async function waitForSessionMode(options: {
  apiUrl: string;
  cellId: string;
  expectedStartMode: "plan" | "build";
  expectedCurrentMode: "plan" | "build";
  timeoutMs?: number;
  failOnTimeout?: boolean;
}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? SESSION_MODE_TIMEOUT_MS;

  const check = async () => {
    const session = await fetchAgentSession(options.apiUrl, options.cellId);
    return (
      session?.startMode === options.expectedStartMode &&
      session.currentMode === options.expectedCurrentMode
    );
  };

  if (options.failOnTimeout === false) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await check()) {
        return true;
      }
      await wait(MODE_POLL_INTERVAL_MS);
    }
    return false;
  }

  await waitForCondition({
    timeoutMs,
    errorMessage: `Session mode mismatch for cell ${options.cellId}`,
    check,
  });

  return true;
}

async function fetchAgentSession(
  apiUrl: string,
  cellId: string
): Promise<AgentSession | null> {
  const payload = await rpcRun<Partial<AgentSession>>(apiUrl, {
    action: "get_agent_session_by_cell",
    input: { cellId },
    fields: ["id", "startMode", "currentMode"],
  });

  if (!(payload.success && payload.data.id)) {
    return null;
  }

  return payload.data as AgentSession;
}

async function waitForPlanToBuildTransition(options: {
  apiUrl: string;
  cellId: string;
  expectedCurrentMode: "plan" | "build";
}): Promise<void> {
  const switched = await waitForSessionMode({
    apiUrl: options.apiUrl,
    cellId: options.cellId,
    expectedStartMode: "plan",
    expectedCurrentMode: options.expectedCurrentMode,
    timeoutMs: BUILD_TRANSITION_TIMEOUT_MS,
  });

  if (!switched) {
    throw new Error(`Session mode mismatch for cell ${options.cellId}`);
  }
}

async function updateSessionMode(options: {
  apiUrl: string;
  sessionId: string;
  mode: "plan" | "build";
}): Promise<void> {
  const payload = await rpcRun<AgentSession>(options.apiUrl, {
    action: "set_agent_session_mode",
    input: { sessionId: options.sessionId, mode: options.mode },
    fields: ["id", "startMode", "currentMode", "modeUpdatedAt"],
  });

  if (!payload.success) {
    throw new Error(
      `Failed to switch session mode to ${options.mode}: ${payload.errors?.[0]?.shortMessage ?? payload.errors?.[0]?.message ?? "unknown error"}`
    );
  }
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

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
