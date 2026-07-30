import { Elysia } from "elysia";
import { vi } from "vitest";
import type { ProcessService } from "../../config/schema";
import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
import { cellServicePorts, cellServices } from "../../schema/services";
import type { ChatTerminalEvent } from "../../services/chat-terminal";
import type { CellTerminalEvent } from "../../services/terminal";
import { createDeferred, testDb } from "../test-db";

export const DEFAULT_TEST_WORKSPACE_ID = "test-workspace";
const DEFAULT_TEST_CELL_ID = "test-cell-id";
const DEFAULT_TEST_WORKSPACE_ROOT = "/tmp/test-workspace-root";
const DEFAULT_TEST_WORKTREE = "/tmp/mock-worktree";
const JSON_HEADERS = { "Content-Type": "application/json" };
const HTTP_OK_STATUS = 200;
const NORMAL_WS_CLOSE_CODE = 1000;

type MockWebSocketArgs = {
  id: string;
  params: { id: string; serviceId?: string };
  query?: { themeMode?: string };
};

type MockWebSocketHandle = {
  socket: unknown;
  messages: Record<string, unknown>[];
  isClosed: () => boolean;
};

type WebSocketHooks = {
  open?: (socket: unknown) => unknown;
  message?: (socket: unknown, message: unknown) => unknown;
  close?: (socket: unknown, code: number, reason: string) => unknown;
};

type WebSocketRoute = { hooks?: { websocket?: WebSocketHooks } };

export const createCellRouteTestApp = (dependencies: any) =>
  new Elysia().use(createCellsRoutes(dependencies));

export const createJsonRequest = (url: string, body: Record<string, unknown>) =>
  new Request(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

const createRouteRequest = (path: string, init?: RequestInit) =>
  new Request(`http://localhost${path}`, init);

const createPostRouteRequest = (
  path: string,
  body?: Record<string, unknown>,
  init?: RequestInit
) =>
  createRouteRequest(path, {
    method: "POST",
    ...(body ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
    ...(init ?? {}),
  });

export const handleRouteRequest = (
  app: { handle: (request: Request) => Promise<Response> },
  path: string,
  init?: RequestInit
) => app.handle(createRouteRequest(path, init));

export const handlePostRouteRequest = (
  app: { handle: (request: Request) => Promise<Response> },
  path: string,
  body?: Record<string, unknown>,
  init?: RequestInit
) => app.handle(createPostRouteRequest(path, body, init));

export const deleteRouteCellById = (
  app: { handle: (request: Request) => Promise<Response> },
  cellId: string
) => handleRouteRequest(app, `/api/cells/${cellId}`, { method: "DELETE" });

export const createResolvedCleanupMocks = () => ({
  runCellTeardown: vi.fn(() => Promise.resolve()),
  removeWorktree: vi.fn(() => Promise.resolve()),
});

export const createBlockedServiceStop = () => {
  const released = createDeferred();
  const started = createDeferred();
  const stop = vi.fn(async () => {
    started.resolve();
    await released.promise;
  });
  return { released, started, stop };
};

export const readTerminalStreamEnvironment = async (
  app: { handle: (request: Request) => Promise<Response> },
  path: string,
  getEnvironment: () => Record<string, string> | undefined
) => {
  const response = await handleRouteRequest(app, path);
  expectResponseStatus(response);
  await response.body?.cancel();
  return getEnvironment();
};

export const expectTerminalEnvironment = (
  environment: Record<string, string> | undefined,
  cellId: string,
  expected: Record<string, string>
) => {
  const expectedEnvironment = {
    HIVE_CELL_ID: cellId,
    HIVE_BROWSE_ROOT: DEFAULT_TEST_WORKTREE,
    ...expected,
  };
  for (const [key, value] of Object.entries(expectedEnvironment)) {
    if (environment?.[key] !== value) {
      throw new Error(`Expected ${key}=${value}, got ${environment?.[key]}`);
    }
  }
  for (const [key, suffix] of [
    ["HIVE_CELL_RUNTIME_DIR", `/runtime/cells/${cellId}`],
    ["HIVE_CELL_ARTIFACTS_DIR", `/artifacts/cells/${cellId}`],
  ] as const) {
    if (!environment?.[key]?.includes(suffix)) {
      throw new Error(`Expected ${key} to include ${suffix}`);
    }
  }
};

const expectResponseStatus = (response: Response, status = HTTP_OK_STATUS) => {
  if (response.status !== status) {
    throw new Error(`Expected status ${status}, got ${response.status}`);
  }
};

export const expectJsonPayload = async <TPayload>(
  response: Response,
  status = HTTP_OK_STATUS
) => {
  expectResponseStatus(response, status);
  return (await response.json()) as TPayload;
};

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

const createEventStreamReader = (
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
  expectResponseStatus(response);
  return createEventStreamReader(response, missingMessage);
};

export const expectEventStreamHeaders = (response: Response) => {
  expectResponseStatus(response);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`Expected event stream response, got ${contentType}`);
  }
};

export const expectStreamEvent = async (
  reader: { read: () => Promise<string> },
  event: string,
  expectedText?: string
) => {
  const text = await reader.read();
  if (!text.includes(`event: ${event}`)) {
    throw new Error(`Expected ${event} event, got ${text}`);
  }
  if (expectedText && !text.includes(expectedText)) {
    throw new Error(`Expected event text ${expectedText}, got ${text}`);
  }
  return text;
};

export const expectReadyAndSnapshotEvents = async (reader: {
  read: () => Promise<string>;
}) => {
  await expectStreamEvent(reader, "ready");
  await expectStreamEvent(reader, "snapshot");
};

export const expectLiveDataEvent = async (args: {
  reader: { read: () => Promise<string> };
  emit: () => void;
  expectedText: string;
}) => {
  args.emit();
  await expectStreamEvent(args.reader, "data", args.expectedText);
};

export const expectPtyStreamData = async (args: {
  response: Response;
  missingMessage: string;
  emit: () => void;
  expectedText: string;
}) => {
  expectEventStreamHeaders(args.response);
  const reader = await expectEventStreamResponse(
    args.response,
    args.missingMessage
  );
  await expectReadyAndSnapshotEvents(reader);
  await expectLiveDataEvent({
    reader,
    emit: args.emit,
    expectedText: args.expectedText,
  });
  await reader.cancel();
};

export const openRouteEventStream = async (
  app: { handle: (request: Request) => Promise<Response> },
  path: string,
  missingMessage?: string
) => {
  const response = await handleRouteRequest(app, path);
  expectEventStreamHeaders(response);
  return createEventStreamReader(response, missingMessage);
};

export const expectResizePayload = async (
  response: Response,
  cols: number,
  rows: number
) => {
  const payload = await expectJsonPayload<{
    ok: boolean;
    session: { cols: number; rows: number };
  }>(response);
  if (!payload.ok) {
    throw new Error("Expected resize response ok");
  }
  if (payload.session.cols !== cols || payload.session.rows !== rows) {
    throw new Error(
      `Expected ${cols}x${rows}, got ${payload.session.cols}x${payload.session.rows}`
    );
  }
};

const expectPtyResizeResponse = async (args: {
  response: Response;
  resize: unknown;
  cellId: string;
  cols: number;
  rows: number;
}) => {
  expectResponseStatus(args.response);
  if (!mockWasCalledWith(args.resize, [args.cellId, args.cols, args.rows])) {
    throw new Error(`Expected PTY resize ${args.cols}x${args.rows}`);
  }
  await expectResizePayload(args.response, args.cols, args.rows);
};

export const expectPtyRestartResponse = (args: {
  response: Response;
  closeSession: unknown;
  ensureSession: unknown;
  cellId: string;
  ensureArgs: Record<string, unknown>;
}) => {
  expectResponseStatus(args.response);
  if (!mockWasCalledWith(args.closeSession, [args.cellId])) {
    throw new Error("Expected restart to close PTY session");
  }
  if (!mockWasCalledWithObject(args.ensureSession, args.ensureArgs)) {
    throw new Error("Expected restart to recreate PTY session");
  }
};

export const expectSeededPtyResize = async (args: {
  postAction: (
    action: "resize",
    body: Record<string, unknown>
  ) => Promise<{ harness: { resize: unknown }; response: Response }>;
  cellId: string;
  cols: number;
  rows: number;
}) => {
  const result = await args.postAction("resize", {
    cols: args.cols,
    rows: args.rows,
  });
  await expectPtyResizeResponse({
    response: result.response,
    resize: result.harness.resize,
    cellId: args.cellId,
    cols: args.cols,
    rows: args.rows,
  });
};

const getWebSocketHooks = (app: unknown, path: string) => {
  const routes = (app as { router: { history: unknown[] } }).router.history;
  const route = routes.find(
    (entry) =>
      (entry as { method?: string }).method === "WS" &&
      (entry as { path?: string }).path === path
  ) as WebSocketRoute | undefined;

  if (!route?.hooks?.websocket) {
    throw new Error(`Websocket route not found for ${path}`);
  }

  return route.hooks.websocket;
};

const createMockWebSocket = (args: MockWebSocketArgs) => {
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

export const openMockWebSocket = async (
  args: {
    app: unknown;
    path: string;
  } & MockWebSocketArgs
) => {
  const { app, path, ...socketArgs } = args;
  const hooks = getWebSocketHooks(app, path);
  const ws = createMockWebSocket(socketArgs);
  await hooks.open?.(ws.socket);
  return { hooks, ws };
};

const webSocketSent = (
  ws: { messages: Record<string, unknown>[] },
  predicate: (entry: Record<string, unknown>) => boolean
) => ws.messages.some(predicate);

const assertWebSocketMessage = (
  ws: { messages: Record<string, unknown>[] },
  predicate: (entry: Record<string, unknown>) => boolean
) => {
  if (!webSocketSent(ws, predicate)) {
    throw new Error("Expected websocket message was not sent");
  }
};

const assertWebSocketType = (
  ws: { messages: Record<string, unknown>[] },
  type: string
) => assertWebSocketMessage(ws, (entry) => entry.type === type);

const expectWebSocketStartupError = (
  ws: { messages: Record<string, unknown>[]; isClosed: () => boolean },
  message: string
) => {
  assertWebSocketMessage(
    ws,
    (entry) => entry.type === "error" && entry.message === message
  );
  if (!ws.isClosed()) {
    throw new Error("Expected websocket startup failure to close socket");
  }
};

export const expectFailedWebSocketOpen = async (
  args: {
    app: unknown;
    path: string;
    message: string;
  } & MockWebSocketArgs
) => {
  const { message, ...socketArgs } = args;
  const { ws } = await openMockWebSocket(socketArgs);
  expectWebSocketStartupError(ws, message);
};

const sendWebSocketJson = (
  hooks: WebSocketHooks,
  socket: unknown,
  payload: Record<string, unknown>
) => hooks.message?.(socket, JSON.stringify(payload));

const mockWasCalledWith = (mock: unknown, expected: unknown[]) => {
  const calls = (mock as { mock?: { calls?: unknown[][] } }).mock?.calls ?? [];
  return calls.some(
    (call) => stableStringify(call) === stableStringify(expected)
  );
};

const stableStringify = (value: unknown): string => {
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`
    )
    .join(",")}}`;
};

const mockCallCount = (mock: unknown) =>
  (mock as { mock?: { calls?: unknown[][] } }).mock?.calls?.length ?? 0;

const mockWasCalledWithObject = (
  mock: unknown,
  expected: Record<string, unknown>
) => {
  const calls = (mock as { mock?: { calls?: unknown[][] } }).mock?.calls ?? [];
  return calls.some((call) => {
    const actual = call[0] as Record<string, unknown> | undefined;
    return Object.entries(expected).every(
      ([key, value]) =>
        stableStringify(actual?.[key]) === stableStringify(value)
    );
  });
};

const sendWebSocketInputAndAssert = async (args: {
  hooks: WebSocketHooks;
  socket: unknown;
  write: unknown;
  cellId: string;
  data: string;
}) => {
  await sendWebSocketJson(args.hooks, args.socket, {
    type: "input",
    data: args.data,
  });
  if (!mockWasCalledWith(args.write, [args.cellId, args.data])) {
    throw new Error(`Expected websocket input ${args.data}`);
  }
};

const sendWebSocketResizeAndAssert = async (args: {
  hooks: WebSocketHooks;
  socket: unknown;
  resize: unknown;
  cellId: string;
  cols: number;
  rows: number;
}) => {
  await sendWebSocketJson(args.hooks, args.socket, {
    type: "resize",
    cols: args.cols,
    rows: args.rows,
  });
  if (!mockWasCalledWith(args.resize, [args.cellId, args.cols, args.rows])) {
    throw new Error(`Expected websocket resize ${args.cols}x${args.rows}`);
  }
};

const sendHandleInputAndAssert = async (
  args: {
    hooks: WebSocketHooks;
    ws: MockWebSocketHandle;
    write: unknown;
    cellId: string;
  },
  data: string
) =>
  sendWebSocketInputAndAssert({
    hooks: args.hooks,
    socket: args.ws.socket,
    write: args.write,
    cellId: args.cellId,
    data,
  });

const expectSocketOpenAfterNormalClose = (args: {
  hooks: WebSocketHooks;
  ws: MockWebSocketHandle;
}) => {
  closeWebSocketNormally(args.hooks, args.ws.socket);
  if (args.ws.isClosed()) {
    throw new Error("Expected normal websocket close to keep socket open");
  }
};

const exerciseCachedRestartWebSocket = async (args: {
  hooks: WebSocketHooks;
  ws: MockWebSocketHandle;
  cellId: string;
  deleteCell: () => Promise<void>;
  write: unknown;
  closeSession: unknown;
}) => {
  await args.deleteCell();
  await sendHandleInputAndAssert(args, "cached\n");
  await sendWebSocketJson(args.hooks, args.ws.socket, { type: "restart" });
  if (!mockWasCalledWith(args.closeSession, [args.cellId])) {
    throw new Error("Expected websocket restart to close session");
  }
  assertWebSocketMessage(
    args.ws,
    (entry) => entry.type === "snapshot" && typeof entry.output === "string"
  );
  expectSocketOpenAfterNormalClose(args);
};

export const exercisePtyWebSocketActions = async (args: {
  hooks: WebSocketHooks;
  ws: MockWebSocketHandle;
  cellId: string;
  input: string;
  cols: number;
  rows: number;
  write: unknown;
  resize: unknown;
  closeSession: unknown;
  deleteCell: () => Promise<void>;
  invalidResize?: { cols: number; rows: number; message: string };
}) => {
  assertWebSocketType(args.ws, "ready");
  await sendHandleInputAndAssert(args, args.input);
  await sendWebSocketResizeAndAssert({
    hooks: args.hooks,
    socket: args.ws.socket,
    resize: args.resize,
    cellId: args.cellId,
    cols: args.cols,
    rows: args.rows,
  });
  if (args.invalidResize) {
    await sendWebSocketJson(args.hooks, args.ws.socket, {
      type: "resize",
      cols: args.invalidResize.cols,
      rows: args.invalidResize.rows,
    });
    if (mockCallCount(args.resize) !== 1) {
      throw new Error("Expected invalid websocket resize to be rejected");
    }
    assertWebSocketMessage(
      args.ws,
      (entry) =>
        entry.type === "error" && entry.message === args.invalidResize?.message
    );
  }
  await exerciseCachedRestartWebSocket(args);
};

export const exerciseBasicTerminalWebSocket = async (args: {
  hooks: WebSocketHooks;
  ws: MockWebSocketHandle;
  input: string;
  cols: number;
  rows: number;
  readInputs: () => string[];
}) => {
  assertWebSocketType(args.ws, "ready");
  await sendWebSocketJson(args.hooks, args.ws.socket, {
    type: "input",
    data: args.input,
  });
  if (JSON.stringify(args.readInputs()) !== JSON.stringify([args.input])) {
    throw new Error(`Expected websocket input ${args.input}`);
  }
  await sendWebSocketJson(args.hooks, args.ws.socket, {
    type: "resize",
    cols: args.cols,
    rows: args.rows,
  });
  assertWebSocketType(args.ws, "ready");
  await sendWebSocketJson(args.hooks, args.ws.socket, { type: "ping" });
  assertWebSocketType(args.ws, "pong");
  expectSocketOpenAfterNormalClose(args);
};

const closeWebSocketNormally = (
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
    runCellTeardown: async () => Promise.resolve(),
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
    ({
      cellId,
      workspacePath,
    }: {
      cellId: string;
      workspacePath: string;
      environment: Record<string, string>;
    }) => {
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
    definition?: Partial<Omit<ProcessService, "type">>;
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
      env,
      ...args.definition,
    },
    lastKnownError: null,
    createdAt: now,
    updatedAt: args.updatedAt ?? now,
  });
};

export const createRouteServiceTerminalSession = (args: {
  sessionId: string;
  pid: number;
  cwd?: string;
}) => ({
  sessionId: args.sessionId,
  pid: args.pid,
  cwd: args.cwd ?? DEFAULT_TEST_WORKTREE,
  cols: 120,
  rows: 36,
  status: "running" as const,
  exitCode: null,
  startedAt: new Date().toISOString(),
});

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

type RouteServicePortFixture = Pick<
  typeof cellServicePorts.$inferInsert,
  "name" | "port"
> &
  Partial<Pick<typeof cellServicePorts.$inferInsert, "primary">>;

export const seedRouteCellAndServiceWithPorts = async (args: {
  cell?: Parameters<typeof seedRouteCell>[0];
  service?: Parameters<typeof seedRouteService>[0];
  ports: RouteServicePortFixture[];
}) => {
  await seedRouteCellAndService(args);
  const serviceId = args.service?.id ?? "test-service-id";
  const now = new Date();
  if (args.ports.length) {
    await testDb.insert(cellServicePorts).values(
      args.ports.map((port) => ({
        ...port,
        serviceId,
        primary: port.primary ?? false,
        createdAt: now,
        updatedAt: now,
      }))
    );
  }
};

export const clearRouteServicesAndCells = async () => {
  await testDb.delete(cellServicePorts);
  await testDb.delete(cellServices);
  await testDb.delete(cells);
};

export const ptyRouteTestHelpers = {
  exercisePtyWebSocketActions,
  expectFailedWebSocketOpen,
  expectTerminalEnvironment,
  expectPtyRestartResponse,
  expectPtyStreamData,
  expectSeededPtyResize,
  handlePostRouteRequest,
  openMockWebSocket,
  seedRouteCell,
  seedRouteService,
  seedRouteCellAndServiceWithPorts,
};
