import { Elysia } from "elysia";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
import type {
  ChatTerminalEvent,
  ChatTerminalSession,
} from "../../services/chat-terminal";
import { setupTestDb, testDb } from "../test-db";

const TEST_WORKSPACE_ID = "test-workspace";
const TEST_CELL_ID = "test-chat-cell-id";
const HTTP_OK = 200;
const RESIZED_COLS = 132;
const RESIZED_ROWS = 42;
const SERVER_URL = "http://127.0.0.1:4096";
const AGENT_SESSION_ID = "agent-session-1";
const NORMAL_WS_CLOSE_CODE = 1000;

function createChatTerminalHarness() {
  const listeners = new Set<(event: ChatTerminalEvent) => void>();
  let sequence = 0;
  let session: ChatTerminalSession = {
    sessionId: "chat-terminal-0",
    cellId: TEST_CELL_ID,
    pid: 9876,
    cwd: "/tmp/mock-worktree",
    cols: 120,
    rows: 36,
    status: "running",
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
      opencodeSessionId: string;
      opencodeServerUrl: string;
      preferredModel?: { providerId: string; modelId: string };
    }) => {
      sequence += 1;
      session = {
        ...session,
        sessionId: `chat-terminal-${sequence}`,
        cellId,
        cwd: workspacePath,
        status: "running",
        exitCode: null,
      };
      return session;
    }
  );

  const readOutput = vi.fn(() => "chat> ready\n");
  const subscribe = vi.fn(
    (
      _cellId: string,
      listener: (event: ChatTerminalEvent) => void
    ): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  );
  const write = vi.fn((_cellId: string, _data: string) => 0);
  const resize = vi.fn((_cellId: string, cols: number, rows: number) => {
    session = {
      ...session,
      cols,
      rows,
    };
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
    emit(event: ChatTerminalEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

function createDependencies(
  harness: ReturnType<typeof createChatTerminalHarness>
): any {
  const ensureAgentSession = vi.fn(async () => ({
    id: AGENT_SESSION_ID,
    cellId: TEST_CELL_ID,
    templateId: "template",
    provider: "opencode",
    status: "awaiting_input",
    workspacePath: "/tmp/mock-worktree",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    modelId: "big-pickle",
    modelProviderId: "opencode",
  }));

  return {
    db: testDb,
    resolveWorkspaceContext: (async () => ({
      workspace: {
        id: TEST_WORKSPACE_ID,
        label: "Test Workspace",
        path: "/tmp/test-workspace-root",
        addedAt: new Date().toISOString(),
      },
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
        removeWorktree: async () => Promise.resolve(),
      }),
      createWorktree: async () => ({
        path: "/tmp",
        branch: "b",
        baseCommit: "c",
      }),
      removeWorktree: async () => Promise.resolve(),
    })) as any,
    ensureAgentSession: ensureAgentSession as any,
    closeAgentSession: async () => Promise.resolve(),
    ensureServicesForCell: async () => Promise.resolve(),
    startServicesForCell: async () => Promise.resolve(),
    stopServicesForCell: async () => Promise.resolve(),
    startServiceById: async () => Promise.resolve(),
    stopServiceById: async () => Promise.resolve(),
    sendAgentMessage: async () => Promise.resolve(),
    ensureTerminalSession: vi.fn(({ cellId, workspacePath }) => ({
      sessionId: "terminal-0",
      cellId,
      pid: 1000,
      cwd: workspacePath,
      cols: 120,
      rows: 36,
      status: "running",
      exitCode: null,
      startedAt: new Date().toISOString(),
    })),
    readTerminalOutput: () => "",
    subscribeToTerminal: () => () => 0,
    writeTerminalInput: () => 0,
    resizeTerminal: () => 0,
    closeTerminalSession: () => 0,
    ensureChatTerminalSession: harness.ensureSession,
    readChatTerminalOutput: harness.readOutput,
    subscribeToChatTerminal: harness.subscribe,
    writeChatTerminalInput: harness.write,
    resizeChatTerminal: harness.resize,
    closeChatTerminalSession: harness.closeSession,
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
  };
}

async function seedCell() {
  await testDb.insert(cells).values({
    id: TEST_CELL_ID,
    name: "Chat Terminal Cell",
    description: null,
    templateId: "template",
    workspacePath: "/tmp/mock-worktree",
    workspaceId: TEST_WORKSPACE_ID,
    workspaceRootPath: "/tmp/test-workspace-root",
    opencodeSessionId: null,
    createdAt: new Date(),
    status: "ready",
    lastSetupError: null,
    branchName: null,
    baseCommit: null,
    resumeAgentSessionOnStartup: false,
  });
}

const getWebSocketHooks = (app: unknown, path: string) => {
  const routes = (app as unknown as { router: { history: unknown[] } }).router
    .history;
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

const createMockWebSocket = (args: {
  id: string;
  params: { id: string };
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

describe("Cell chat terminal routes", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await testDb.delete(cells);
    process.env.HIVE_OPENCODE_SERVER_URL = SERVER_URL;
  });

  afterEach(() => {
    process.env.HIVE_OPENCODE_SERVER_URL = "";
  });

  it("streams chat terminal readiness, snapshot, and live output", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const deps = createDependencies(harness);
    const app = new Elysia().use(createCellsRoutes(deps));

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/chat/terminal/stream?themeMode=light`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(deps.ensureAgentSession).toHaveBeenCalledWith(TEST_CELL_ID);
    expect(harness.ensureSession).toHaveBeenCalledWith({
      cellId: TEST_CELL_ID,
      workspacePath: "/tmp/mock-worktree",
      opencodeSessionId: AGENT_SESSION_ID,
      opencodeServerUrl: SERVER_URL,
      opencodeThemeMode: "light",
      preferredModel: {
        providerId: "opencode",
        modelId: "big-pickle",
      },
    });

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      throw new Error("Response body reader unavailable");
    }

    const decoder = new TextDecoder();
    const decodeChunk = (value: unknown): string => {
      if (typeof value === "string") {
        return value;
      }
      if (value instanceof Uint8Array) {
        return decoder.decode(value);
      }
      if (value instanceof ArrayBuffer) {
        return decoder.decode(new Uint8Array(value));
      }
      return "";
    };

    const readTextChunk = async () => {
      const chunk = await reader.read();
      return decodeChunk(chunk.value);
    };

    const firstChunk = await reader.read();
    const firstText = decodeChunk(firstChunk.value);
    expect(firstText).toContain("event: ready");
    const snapshotText = await readTextChunk();
    expect(snapshotText).toContain("event: snapshot");

    harness.emit({ type: "data", chunk: "assistant> hello\n" });
    const dataText = await readTextChunk();
    expect(dataText).toContain("event: data");
    expect(dataText).toContain("assistant> hello");

    await reader.cancel();
  });

  it("forwards chat terminal input to the chat terminal service", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/chat/terminal/input`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: "hello\n" }),
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "hello\n");
  });

  it("resizes the chat terminal and returns updated dimensions", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/chat/terminal/resize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols: RESIZED_COLS, rows: RESIZED_ROWS }),
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(harness.resize).toHaveBeenCalledWith(
      TEST_CELL_ID,
      RESIZED_COLS,
      RESIZED_ROWS
    );

    const payload = (await response.json()) as {
      ok: boolean;
      session: { cols: number; rows: number };
    };
    expect(payload.ok).toBe(true);
    expect(payload.session.cols).toBe(RESIZED_COLS);
    expect(payload.session.rows).toBe(RESIZED_ROWS);
  });

  it("restarts chat terminal sessions", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/chat/terminal/restart`,
        {
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(harness.closeSession).toHaveBeenCalledWith(TEST_CELL_ID);
    expect(harness.ensureSession).toHaveBeenCalledWith({
      cellId: TEST_CELL_ID,
      workspacePath: "/tmp/mock-worktree",
      opencodeSessionId: AGENT_SESSION_ID,
      opencodeServerUrl: SERVER_URL,
      opencodeThemeMode: "dark",
      preferredModel: {
        providerId: "opencode",
        modelId: "big-pickle",
      },
    });
  });

  it("handles websocket input, resize, restart, and cached session context", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const deps = createDependencies(harness);
    const app = new Elysia().use(createCellsRoutes(deps));
    const hooks = getWebSocketHooks(app, "/api/cells/:id/chat/terminal/ws");
    const ws = createMockWebSocket({
      id: "chat-ws-1",
      params: { id: TEST_CELL_ID },
      query: { themeMode: "light" },
    });

    await hooks.open?.(ws.socket);
    expect(harness.ensureSession).toHaveBeenCalled();
    expect(ws.messages.some((entry) => entry.type === "ready")).toBeTruthy();

    await hooks.message?.(
      ws.socket,
      JSON.stringify({ type: "input", data: "ws hello\n" })
    );
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "ws hello\n");

    await hooks.message?.(
      ws.socket,
      JSON.stringify({
        type: "resize",
        cols: RESIZED_COLS,
        rows: RESIZED_ROWS,
      })
    );
    expect(harness.resize).toHaveBeenCalledWith(
      TEST_CELL_ID,
      RESIZED_COLS,
      RESIZED_ROWS
    );

    await testDb.delete(cells);
    await hooks.message?.(
      ws.socket,
      JSON.stringify({ type: "input", data: "cached\n" })
    );
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "cached\n");

    await hooks.message?.(ws.socket, JSON.stringify({ type: "restart" }));
    expect(harness.closeSession).toHaveBeenCalledWith(TEST_CELL_ID);
    expect(
      ws.messages.some(
        (entry) => entry.type === "snapshot" && typeof entry.output === "string"
      )
    ).toBeTruthy();

    hooks.close?.(ws.socket, NORMAL_WS_CLOSE_CODE, "closed");
    expect(ws.isClosed()).toBeFalsy();
  });
});
