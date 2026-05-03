import { Elysia } from "elysia";
import { vi } from "vitest";
import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
import type { ChatTerminalEvent } from "../../services/chat-terminal";
import type { CellTerminalEvent } from "../../services/terminal";
import { testDb } from "../test-db";

export const DEFAULT_TEST_WORKSPACE_ID = "test-workspace";
const DEFAULT_TEST_CELL_ID = "test-cell-id";
const DEFAULT_TEST_WORKSPACE_ROOT = "/tmp/test-workspace-root";
const DEFAULT_TEST_WORKTREE = "/tmp/mock-worktree";
const JSON_HEADERS = { "Content-Type": "application/json" };
const HTTP_OK_STATUS = 200;
const NORMAL_WS_CLOSE_CODE = 1000;

export const createCellRouteTestApp = (dependencies: any) =>
  new Elysia().use(createCellsRoutes(dependencies));

export const createJsonRequest = (url: string, body: Record<string, unknown>) =>
  new Request(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

export const decodeEventChunk = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(value));
  }
  return "";
};

export const createEventStreamReader = (
  response: Response,
  missingMessage = "Expected SSE reader"
) => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(missingMessage);
  }

  return {
    read: async () => decodeEventChunk((await reader.read()).value),
    cancel: () => reader.cancel(),
  };
};

export const expectEventStreamResponse = (
  response: Response,
  missingMessage?: string
) => {
  if (response.status !== HTTP_OK_STATUS) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  return createEventStreamReader(response, missingMessage);
};

export const getWebSocketHooks = (app: unknown, path: string) => {
  const routes = (app as { router: { history: unknown[] } }).router.history;
  const route = routes.find(
    (entry) =>
      (entry as { method?: string }).method === "WS" &&
      (entry as { path?: string }).path === path
  ) as
    | {
        hooks?: {
          websocket?: {
            open?: (ws: unknown) => unknown;
            message?: (ws: unknown, message: unknown) => unknown;
            close?: (ws: unknown, code: number, reason: string) => unknown;
          };
        };
      }
    | undefined;

  if (!route?.hooks?.websocket) {
    throw new Error(`Websocket route not found for ${path}`);
  }

  return route.hooks.websocket;
};

export const createMockWebSocket = (args: {
  id: string;
  params: { id: string; serviceId?: string };
  query?: { themeMode?: string };
}) => {
  const messages: Record<string, unknown>[] = [];
  let closed = false;

  const socket = {
    id: args.id,
    data: {
      params: args.params,
      ...(args.query ? { query: args.query } : {}),
    },
    send(payload: unknown) {
      if (payload && typeof payload === "object") {
        messages.push(payload as Record<string, unknown>);
      }
    },
    close() {
      closed = true;
    },
  };

  return {
    socket,
    messages,
    isClosed: () => closed,
  };
};

const webSocketSent = (
  ws: { messages: Record<string, unknown>[] },
  predicate: (entry: Record<string, unknown>) => boolean
) => ws.messages.some(predicate);

export const assertWebSocketMessage = (
  ws: { messages: Record<string, unknown>[] },
  predicate: (entry: Record<string, unknown>) => boolean
) => {
  if (!webSocketSent(ws, predicate)) {
    throw new Error("Expected websocket message was not sent");
  }
};

export const assertWebSocketType = (
  ws: { messages: Record<string, unknown>[] },
  type: string
) => assertWebSocketMessage(ws, (entry) => entry.type === type);

export const sendWebSocketJson = (
  hooks: { message?: (socket: unknown, message: unknown) => unknown },
  socket: unknown,
  payload: Record<string, unknown>
) => hooks.message?.(socket, JSON.stringify(payload));

export const closeWebSocketNormally = (
  hooks: { close?: (socket: unknown, code: number, reason: string) => unknown },
  socket: unknown
) => hooks.close?.(socket, NORMAL_WS_CLOSE_CODE, "closed");

export const createCellRouteTestDependencies = (
  args: {
    cellId?: string;
    workspaceId?: string;
    workspacePath?: string;
    workspaceRootPath?: string;
    overrides?: Record<string, unknown>;
  } = {}
): any => {
  const cellId = args.cellId ?? DEFAULT_TEST_CELL_ID;
  const workspaceId = args.workspaceId ?? DEFAULT_TEST_WORKSPACE_ID;
  const workspacePath = args.workspacePath ?? DEFAULT_TEST_WORKTREE;
  const workspaceRootPath =
    args.workspaceRootPath ?? DEFAULT_TEST_WORKSPACE_ROOT;
  const removeWorktree = async (...callArgs: unknown[]) => {
    const override = args.overrides?.removeWorktree as
      | ((...overrideArgs: unknown[]) => Promise<void> | void)
      | undefined;
    await override?.(...callArgs);
  };
  const workspaceRecord = {
    id: workspaceId,
    label: "Test Workspace",
    path: workspaceRootPath,
    addedAt: new Date().toISOString(),
  };

  return {
    db: testDb,
    resolveWorkspaceContext: (async () => ({
      workspace: workspaceRecord,
      loadConfig: async () => ({
        opencode: { defaultProvider: "opencode", defaultModel: "mock" },
        promptSources: [],
        templates: {},
        defaults: {},
      }),
      createWorktreeManager: async () => ({
        createWorktree: async () => ({
          path: "/tmp",
          branch: "b",
          baseCommit: "c",
        }),
        removeWorktree,
      }),
      createWorktree: async () => ({
        path: "/tmp",
        branch: "b",
        baseCommit: "c",
      }),
      removeWorktree,
    })) as any,
    ensureAgentSession: async () => ({ id: "session", cellId }),
    closeAgentSession: async () => Promise.resolve(),
    ensureServicesForCell: async () => Promise.resolve(),
    startServicesForCell: async () => Promise.resolve(),
    stopServicesForCell: async () => Promise.resolve(),
    startServiceById: async () => Promise.resolve(),
    stopServiceById: async () => Promise.resolve(),
    sendAgentMessage: async () => Promise.resolve(),
    ensureTerminalSession: () => ({
      sessionId: "terminal-session",
      cellId,
      pid: 123,
      cwd: workspacePath,
      cols: 120,
      rows: 36,
      status: "running" as const,
      exitCode: null,
      startedAt: new Date().toISOString(),
    }),
    readTerminalOutput: () => "",
    subscribeToTerminal: () => () => 0,
    writeTerminalInput: () => 0,
    resizeTerminal: () => 0,
    closeTerminalSession: () => 0,
    getServiceTerminalSession: () => null,
    readServiceTerminalOutput: () => "",
    subscribeToServiceTerminal: () => () => 0,
    writeServiceTerminalInput: () => 0,
    resizeServiceTerminal: () => 0,
    clearServiceTerminal: () => 0,
    getSetupTerminalSession: () => null,
    readSetupTerminalOutput: () => "",
    subscribeToSetupTerminal: () => () => 0,
    writeSetupTerminalInput: () => 0,
    resizeSetupTerminal: () => 0,
    clearSetupTerminal: () => 0,
    ...(args.overrides ?? {}),
  };
};

const createPtyRouteHarness = <TEvent extends { type: string }>(args: {
  cellId: string;
  sessionIdPrefix: string;
  pid: number;
  output: string;
  workspacePath?: string;
}) => {
  const listeners = new Set<(event: TEvent) => void>();
  let sequence = 0;
  let session = {
    sessionId: `${args.sessionIdPrefix}-0`,
    cellId: args.cellId,
    pid: args.pid,
    cwd: args.workspacePath ?? DEFAULT_TEST_WORKTREE,
    cols: 120,
    rows: 36,
    status: "running" as const,
    exitCode: null,
    startedAt: new Date().toISOString(),
  };

  const ensureSession = vi.fn(
    ({ cellId, workspacePath }: { cellId: string; workspacePath: string }) => {
      sequence += 1;
      session = {
        ...session,
        sessionId: `${args.sessionIdPrefix}-${sequence}`,
        cellId,
        cwd: workspacePath,
        status: "running",
        exitCode: null,
      };
      return session;
    }
  );
  const readOutput = vi.fn(() => args.output);
  const subscribe = vi.fn(
    (_cellId: string, listener: (event: TEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  );
  const write = vi.fn((_cellId: string, _data: string) => 0);
  const resize = vi.fn((_cellId: string, cols: number, rows: number) => {
    session = { ...session, cols, rows };
    return 0;
  });
  const closeSession = vi.fn((_cellId: string) => 0);

  return {
    ensureSession,
    readOutput,
    subscribe,
    write,
    resize,
    closeSession,
    emit(event: TEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
};

export const createCellTerminalRouteHarness = (cellId: string) =>
  createPtyRouteHarness<CellTerminalEvent>({
    cellId,
    sessionIdPrefix: "terminal",
    pid: 4567,
    output: "snapshot> ready\n",
  });

export const createChatTerminalRouteHarness = (cellId: string) =>
  createPtyRouteHarness<ChatTerminalEvent>({
    cellId,
    sessionIdPrefix: "chat-terminal",
    pid: 9876,
    output: "chat> ready\n",
  });

export const seedRouteCell = async (
  args: {
    id?: string;
    name?: string;
    description?: string | null;
    templateId?: string;
    status?: "ready" | "spawning";
    workspaceId?: string;
    workspacePath?: string;
    workspaceRootPath?: string;
    branchName?: string | null;
    baseCommit?: string | null;
  } = {}
) => {
  await testDb.insert(cells).values({
    id: args.id ?? DEFAULT_TEST_CELL_ID,
    name: args.name ?? "Test Cell",
    description: args.description ?? null,
    templateId: args.templateId ?? "template",
    workspacePath: args.workspacePath ?? DEFAULT_TEST_WORKTREE,
    workspaceId: args.workspaceId ?? DEFAULT_TEST_WORKSPACE_ID,
    workspaceRootPath: args.workspaceRootPath ?? DEFAULT_TEST_WORKSPACE_ROOT,
    opencodeSessionId: null,
    createdAt: new Date(),
    status: args.status ?? "ready",
    lastSetupError: null,
    branchName: args.branchName ?? null,
    baseCommit: args.baseCommit ?? null,
    resumeAgentSessionOnStartup: false,
  });
};

export const seedRouteService = async (
  args: {
    id?: string;
    cellId?: string;
    name?: string;
    command?: string;
    cwd?: string;
    env?: Record<string, string>;
    definitionEnv?: Record<string, string>;
    status?:
      | "pending"
      | "starting"
      | "running"
      | "needs_resume"
      | "stopped"
      | "error";
    port?: number | null;
    pid?: number | null;
    type?: "process";
    readyTimeoutMs?: number | null;
    createdAt?: Date;
    updatedAt?: Date;
  } = {}
) => {
  const now = args.createdAt ?? new Date();
  const command = args.command ?? "bun run dev";
  const cwd = args.cwd ?? DEFAULT_TEST_WORKTREE;
  const env = args.env ?? {};

  await testDb.insert(cellServices).values({
    id: args.id ?? "test-service-id",
    cellId: args.cellId ?? DEFAULT_TEST_CELL_ID,
    name: args.name ?? "server",
    type: args.type ?? "process",
    command,
    cwd,
    env,
    status: args.status ?? "running",
    port: args.port ?? null,
    pid: args.pid ?? null,
    readyTimeoutMs: args.readyTimeoutMs ?? null,
    definition: {
      type: args.type ?? "process",
      run: command,
      cwd,
      env: args.definitionEnv ?? env,
    },
    lastKnownError: null,
    createdAt: now,
    updatedAt: args.updatedAt ?? now,
  });
};

export const seedRouteCellAndService = async (
  args: {
    cell?: Parameters<typeof seedRouteCell>[0];
    service?: Parameters<typeof seedRouteService>[0];
  } = {}
) => {
  const cellId = args.cell?.id ?? args.service?.cellId ?? DEFAULT_TEST_CELL_ID;
  await seedRouteCell({ ...(args.cell ?? {}), id: cellId });
  await seedRouteService({ ...(args.service ?? {}), cellId });
};
