import { waitForCondition } from "./wait";

type ApiErrorPayload = {
  message?: string;
};

const CELL_STATUS_TIMEOUT_MS = 150_000;
const SESSION_WAIT_TIMEOUT_MS = 120_000;
const ASSISTANT_MESSAGE_TIMEOUT_MS = 120_000;
const SERVICE_STATUS_TIMEOUT_MS = 90_000;
const ACTIVITY_LIMIT = 200;

export type WorkspaceRecord = {
  id: string;
  label: string;
  path: string;
};

export type CellRecord = {
  id: string;
  templateId: string;
  workspaceId: string;
  workspacePath: string;
  opencodeSessionId: string | null;
  opencodeCommand: string | null;
  status: string;
  lastSetupError?: string;
};

export type AgentSessionRecord = {
  id: string;
  cellId: string;
  status: string;
  startMode?: "plan" | "build";
  currentMode?: "plan" | "build";
};

export type ServiceRecord = {
  id: string;
  name: string;
  status: string;
  pid?: number;
};

export type AgentMessageRecord = {
  id: string;
  role: string;
  state: string;
  content: string | null;
};

export type ActivityRecord = {
  id: string;
  type: string;
};

export async function requestJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new Error(
      payload?.message ??
        `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return payload;
}

export async function listWorkspaces(apiUrl: string): Promise<{
  workspaces: WorkspaceRecord[];
  activeWorkspaceId?: string | null;
}> {
  return await requestJson(`${apiUrl}/api/workspaces`);
}

export async function createCell(
  apiUrl: string,
  body: {
    name: string;
    templateId: string;
    workspaceId: string;
    startMode?: "plan" | "build";
  }
): Promise<CellRecord> {
  return await requestJson(`${apiUrl}/api/cells`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getCell(
  apiUrl: string,
  cellId: string
): Promise<CellRecord> {
  return await requestJson(`${apiUrl}/api/cells/${cellId}`);
}

export async function waitForCellStatus(
  apiUrl: string,
  cellId: string,
  targetStatus: string,
  options: { timeoutMs?: number } = {}
): Promise<CellRecord> {
  let latest: CellRecord | null = null;

  await waitForCondition(
    `cell ${cellId} status=${targetStatus}`,
    async () => {
      latest = await getCell(apiUrl, cellId);

      if (latest.status === "error") {
        throw new Error(
          `Cell ${cellId} entered error state: ${latest.lastSetupError ?? "unknown error"}`
        );
      }

      return latest.status === targetStatus;
    },
    { timeoutMs: options.timeoutMs ?? CELL_STATUS_TIMEOUT_MS, intervalMs: 500 }
  );

  if (!latest) {
    throw new Error(`Failed to load cell ${cellId}`);
  }

  return latest;
}

export async function fetchSessionByCell(
  apiUrl: string,
  cellId: string
): Promise<AgentSessionRecord | null> {
  const payload = await requestJson<{ session: AgentSessionRecord | null }>(
    `${apiUrl}/api/agents/sessions/byCell/${cellId}`
  );
  return payload.session;
}

export async function waitForSessionByCell(
  apiUrl: string,
  cellId: string,
  options: { timeoutMs?: number } = {}
): Promise<AgentSessionRecord> {
  let session: AgentSessionRecord | null = null;

  await waitForCondition(
    `agent session for cell ${cellId}`,
    async () => {
      session = await fetchSessionByCell(apiUrl, cellId);
      return session !== null;
    },
    { timeoutMs: options.timeoutMs ?? SESSION_WAIT_TIMEOUT_MS, intervalMs: 500 }
  );

  if (!session) {
    throw new Error(`No session found for cell ${cellId}`);
  }

  return session;
}

export async function fetchSessionMessages(
  apiUrl: string,
  sessionId: string
): Promise<AgentMessageRecord[]> {
  const payload = await requestJson<{ messages: AgentMessageRecord[] }>(
    `${apiUrl}/api/agents/sessions/${sessionId}/messages`
  );
  return payload.messages;
}

export async function waitForAssistantMessage(
  apiUrl: string,
  sessionId: string,
  options: { timeoutMs?: number } = {}
): Promise<AgentMessageRecord> {
  let assistantMessage: AgentMessageRecord | null = null;

  await waitForCondition(
    `assistant message for session ${sessionId}`,
    async () => {
      const messages = await fetchSessionMessages(apiUrl, sessionId);
      assistantMessage =
        messages
          .slice()
          .reverse()
          .find((message) => message.role === "assistant") ?? null;
      return assistantMessage !== null;
    },
    {
      timeoutMs: options.timeoutMs ?? ASSISTANT_MESSAGE_TIMEOUT_MS,
      intervalMs: 500,
    }
  );

  if (!assistantMessage) {
    throw new Error(`Assistant message not found for session ${sessionId}`);
  }

  return assistantMessage;
}

export async function listServices(
  apiUrl: string,
  cellId: string
): Promise<ServiceRecord[]> {
  const payload = await requestJson<{ services: ServiceRecord[] }>(
    `${apiUrl}/api/cells/${cellId}/services`
  );
  return payload.services;
}

export async function listCells(
  apiUrl: string,
  workspaceId: string
): Promise<CellRecord[]> {
  const payload = await requestJson<{ cells: CellRecord[] }>(
    `${apiUrl}/api/cells?workspaceId=${workspaceId}`
  );
  return payload.cells;
}

export async function waitForServiceStatus(args: {
  apiUrl: string;
  cellId: string;
  serviceId: string;
  predicate: (status: string) => boolean;
  timeoutMs?: number;
  label?: string;
}): Promise<ServiceRecord> {
  let selected: ServiceRecord | null = null;

  await waitForCondition(
    args.label ?? `service ${args.serviceId} status check`,
    async () => {
      const services = await listServices(args.apiUrl, args.cellId);
      selected =
        services.find((service) => service.id === args.serviceId) ?? null;
      return Boolean(selected && args.predicate(selected.status));
    },
    {
      timeoutMs: args.timeoutMs ?? SERVICE_STATUS_TIMEOUT_MS,
      intervalMs: 500,
    }
  );

  if (!selected) {
    throw new Error(
      `Service ${args.serviceId} not found in cell ${args.cellId}`
    );
  }

  return selected;
}

export async function listActivity(
  apiUrl: string,
  cellId: string
): Promise<ActivityRecord[]> {
  const payload = await requestJson<{ events: ActivityRecord[] }>(
    `${apiUrl}/api/cells/${cellId}/activity?limit=${String(ACTIVITY_LIMIT)}`
  );
  return payload.events;
}

export async function deleteCell(
  apiUrl: string,
  cellId: string
): Promise<void> {
  await requestJson(`${apiUrl}/api/cells/${cellId}`, {
    method: "DELETE",
  });
}

export async function postCellAction(
  apiUrl: string,
  path: string,
  body?: unknown
): Promise<void> {
  await requestJson(`${apiUrl}${path}`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

export async function createWorkspace(
  apiUrl: string,
  body: { path: string; label?: string; activate?: boolean }
): Promise<WorkspaceRecord> {
  const payload = await requestJson<{ workspace: WorkspaceRecord }>(
    `${apiUrl}/api/workspaces`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return payload.workspace;
}
