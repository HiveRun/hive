// @ts-nocheck
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRecord } from "../../agents/types";
import type { HiveConfig } from "../../config/schema";
import { createCellsRoutes, resumeSpawningCells } from "../../routes/cells";

import { cellProvisioningStates } from "../../schema/cell-provisioning";
import { cells } from "../../schema/cells";
import { cellTimingEvents } from "../../schema/timing-events";
import type { ServiceSupervisorError } from "../../services/supervisor";
import {
  CommandExecutionError,
  TemplateSetupError,
} from "../../services/supervisor";
import { setupTestDb, testDb } from "../test-db";
import {
  createCellRouteTestDependencies,
  createJsonRequest,
} from "./cells-route-test-helpers";

const templateId = "failing-template";
const workspacePath = "/tmp/mock-worktree";
const OK_STATUS = 200;
const CREATED_STATUS = 201;
const BAD_REQUEST_STATUS = 400;
const CONFLICT_STATUS = 409;
const WAIT_TIMEOUT_MS = 500;
const WAIT_INTERVAL_MS = 10;
const DETACHED_PROMPT_READY_TIMEOUT_MS = 2000;
const TEST_PR_NUMBER = 123;
const CELLS_API_URL = "http://localhost/api/cells";
const TEST_INITIAL_PROMPT_IMAGE = {
  filename: "cell.png",
  mimeType: "image/png",
  base64Data: "aGVsbG8=",
};
const TEST_INITIAL_PROMPT_FILE_PART = {
  type: "file",
  mime: TEST_INITIAL_PROMPT_IMAGE.mimeType,
  filename: TEST_INITIAL_PROMPT_IMAGE.filename,
  url: `data:${TEST_INITIAL_PROMPT_IMAGE.mimeType};base64,${TEST_INITIAL_PROMPT_IMAGE.base64Data}`,
};

const defaultCreateBody = (
  name: string,
  values: Record<string, unknown> = {}
) => ({
  name,
  templateId,
  workspaceId: "test-workspace",
  ...values,
});

const mockWorktree = () => ({
  path: workspacePath,
  branch: "cell-branch",
  baseCommit: "abc123",
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = WAIT_TIMEOUT_MS
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await sleep(WAIT_INTERVAL_MS);
  }
  throw new Error("Condition not met within timeout");
}

async function waitForCellStatus(
  cellId: string,
  status: string,
  timeoutMs = WAIT_TIMEOUT_MS
) {
  let latestRow: typeof cells.$inferSelect | undefined;
  await waitForCondition(async () => {
    const rows = await testDb.select().from(cells);
    latestRow = rows.find((row) => row.id === cellId);
    return latestRow?.status === status;
  }, timeoutMs);
  if (!latestRow) {
    throw new Error(`Cell ${cellId} not found`);
  }
  return latestRow;
}

async function waitForTimingStep(cellId: string, step: string) {
  let found: typeof cellTimingEvents.$inferSelect | undefined;
  await waitForCondition(async () => {
    const rows = await testDb
      .select()
      .from(cellTimingEvents)
      .where(eq(cellTimingEvents.cellId, cellId));
    found = rows.find((row) => row.step === step);
    return Boolean(found);
  });

  if (!found) {
    throw new Error(`Timing step ${step} not found for ${cellId}`);
  }

  return found;
}

function makeJsonPostRequest(url: string, body: Record<string, unknown>) {
  return createJsonRequest(url, body);
}

function postCreateCell(
  app: Elysia,
  body: Record<string, unknown>
): Promise<Response> {
  return app.handle(makeJsonPostRequest(CELLS_API_URL, body));
}

function postSetupRetry(app: Elysia, cellId: string): Promise<Response> {
  return app.handle(
    new Request(`${CELLS_API_URL}/${cellId}/setup/retry`, {
      method: "POST",
    })
  );
}

function deleteCellById(app: Elysia, cellId: string): Promise<Response> {
  return app.handle(
    new Request(`${CELLS_API_URL}/${cellId}`, {
      method: "DELETE",
    })
  );
}

async function insertCellRow(
  values: Partial<typeof cells.$inferInsert> & {
    id: string;
    name: string;
  }
) {
  await testDb.insert(cells).values({
    templateId,
    workspaceId: "test-workspace",
    workspacePath,
    workspaceRootPath: "/tmp/test-workspace-root",
    branchName: "cell-branch",
    baseCommit: "abc123",
    opencodeSessionId: null,
    createdAt: new Date(),
    status: "ready",
    lastSetupError: null,
    ...values,
  });
}

async function insertProvisioningStateRow(
  cellId: string,
  values: Partial<typeof cellProvisioningStates.$inferInsert> = {}
) {
  await testDb.insert(cellProvisioningStates).values({
    cellId,
    modelIdOverride: null,
    providerIdOverride: null,
    attemptCount: 0,
    startedAt: null,
    finishedAt: null,
    ...values,
  });
}

const hiveConfig: HiveConfig = {
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "mock-model",
  },
  promptSources: [],
  templates: {
    [templateId]: {
      id: templateId,
      label: "Failing Template",
      type: "manual",
      setup: ["bun setup"],
    },
  },
  defaults: {},
};

type SendAgentMessageFn = (sessionId: string, content: string) => Promise<void>;
type EnsureServicesForCellFn = (args: unknown) => Promise<void>;
type CreateWorktreeFn = (
  cellId: string,
  options?: {
    templateId?: string;
    force?: boolean;
    startPoint?:
      | { mode: "head" }
      | { mode: "branch"; value: string }
      | { mode: "pr"; value: string };
    onTimingEvent?: (event: {
      step: string;
      durationMs: number;
      metadata?: Record<string, unknown>;
    }) => void;
  }
) => Promise<{
  path: string;
  branch: string;
  baseCommit: string;
}>;

type DependencyFactoryOptions = {
  setupError?: TemplateSetupError;
  sendAgentMessage?: SendAgentMessageFn;
  ensureServicesForCell?: EnsureServicesForCellFn;
  createWorktree?: CreateWorktreeFn;
  onEnsureAgentSession?: (
    cellId: string,
    sessionId: string,
    overrides?: {
      modelId?: string;
      providerId?: string;
      startMode?: "plan" | "build";
    }
  ) => void;
  hiveConfigOverride?: HiveConfig;
};
type AgentSessionOverrides = {
  modelId?: string;
  providerId?: string;
  startMode?: "plan" | "build";
};

let removeWorktreeCalls = 0;

function createDependencies(options: DependencyFactoryOptions = {}): any {
  const workspaceRecord = {
    id: "test-workspace",
    label: "Test Workspace",
    path: "/tmp/test-workspace-root",
    addedAt: new Date().toISOString(),
  };

  const loadWorkspaceConfig = () =>
    Promise.resolve(options.hiveConfigOverride ?? hiveConfig);

  const buildWorktree = (
    cellId: string,
    createOptions?: Parameters<CreateWorktreeFn>[1]
  ) =>
    Promise.resolve(mockWorktree()).then((defaultWorktree) => {
      if (options.createWorktree) {
        return options.createWorktree(cellId, createOptions);
      }
      return defaultWorktree;
    });

  const removeWorktreeCall = () =>
    Promise.resolve().then(() => {
      removeWorktreeCalls += 1;
    });

  const sendAgentMessageImpl =
    options.sendAgentMessage ?? vi.fn<SendAgentMessageFn>().mockResolvedValue();

  return createCellRouteTestDependencies({
    cellId: "cell",
    workspacePath,
    overrides: {
      resolveWorkspaceContext: (async () => ({
        workspace: workspaceRecord,
        loadConfig: loadWorkspaceConfig,
        createWorktreeManager: async () => ({
          createWorktree: (
            cellId: string,
            createOptions?: Parameters<CreateWorktreeFn>[1]
          ) => buildWorktree(cellId, createOptions),
          removeWorktree: (_cellId: string) => removeWorktreeCall(),
        }),
        createWorktree: (
          cellId: string,
          createOptions?: Parameters<CreateWorktreeFn>[1]
        ) => buildWorktree(cellId, createOptions),
        removeWorktree: (_cellId: string) => removeWorktreeCall(),
      })) as any,

      ensureAgentSession: (
        cellId: string,
        overrides?: {
          modelId?: string;
          providerId?: string;
          startMode?: "plan" | "build";
        }
      ) =>
        Promise.resolve().then(() => {
          const session: AgentSessionRecord = {
            id: `session-${cellId}`,
            cellId,
            templateId,
            provider: "opencode",
            status: "awaiting_input",
            workspacePath,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          options.onEnsureAgentSession?.(cellId, session.id, overrides);
          return session;
        }),
      closeAgentSession: async (_cellId: string) => Promise.resolve(),
      ensureServicesForCell: (_args: any) => {
        if (options.ensureServicesForCell) {
          return options.ensureServicesForCell(_args);
        }
        if (options.setupError) {
          throw {
            _tag: "ServiceSupervisorError",
            cause: options.setupError,
          } as ServiceSupervisorError;
        }
        return Promise.resolve();
      },
      startServicesForCell: async (_cellId: string) => Promise.resolve(),
      stopServicesForCell: (
        _cellId: string,
        _options?: { releasePorts?: boolean }
      ) => Promise.resolve(),
      startServiceById: (_serviceId: string) => Promise.resolve(),
      stopServiceById: (
        _serviceId: string,
        _options?: { releasePorts?: boolean }
      ) => Promise.resolve(),
      sendAgentMessage: (sessionId: string, content: string) =>
        sendAgentMessageImpl(sessionId, content),
    },
  });
}

function createTestApp(options: DependencyFactoryOptions = {}) {
  return new Elysia().use(createCellsRoutes(createDependencies(options)));
}

const createAgentOverrideCapture = (
  options: Omit<DependencyFactoryOptions, "onEnsureAgentSession"> = {}
) => {
  let captured: AgentSessionOverrides | undefined;
  const app = createTestApp({
    ...options,
    onEnsureAgentSession: (_cellId, _sessionId, overrides) => {
      captured = overrides;
    },
  });
  return { app, read: () => captured };
};

async function createCellAndExpectSpawning(args: {
  app: Elysia;
  body: Record<string, unknown>;
}) {
  const response = await postCreateCell(args.app, args.body);

  if (response.status !== CREATED_STATUS) {
    throw new Error(
      `Expected status ${CREATED_STATUS}, got ${response.status}`
    );
  }

  const payload = (await response.json()) as {
    id: string;
    status: string;
    lastSetupError?: string;
  };
  if (payload.status !== "spawning") {
    throw new Error(`Expected status spawning, got ${payload.status}`);
  }

  return payload;
}

async function createCellAndWaitReady(args: {
  app: Elysia;
  body: Record<string, unknown>;
}) {
  const payload = await createCellAndExpectSpawning(args);
  await waitForCellStatus(payload.id, "ready");
  return payload;
}

async function createPromptDispatchScenario(body: Record<string, unknown>) {
  const sendAgentMessage = vi
    .fn<SendAgentMessageFn>()
    .mockResolvedValue(undefined);
  let capturedSessionId: string | null = null;
  const app = createTestApp({
    sendAgentMessage,
    onEnsureAgentSession: (_cellId, sessionId) => {
      capturedSessionId = sessionId;
    },
  });

  await createCellAndWaitReady({ app, body });
  await waitForCondition(() => Boolean(capturedSessionId));
  await waitForCondition(() => sendAgentMessage.mock.calls.length === 1);

  return { sendAgentMessage, capturedSessionId };
}

async function captureCreateWorktreeStartPoint(body: Record<string, unknown>) {
  let capturedWorktreeOptions: Parameters<CreateWorktreeFn>[1] | undefined;
  const app = createTestApp({
    createWorktree: (_cellId, createOptions) => {
      capturedWorktreeOptions = createOptions;
      return Promise.resolve(mockWorktree());
    },
  });

  await createCellAndWaitReady({ app, body });
  await waitForCondition(() => Boolean(capturedWorktreeOptions));
  return capturedWorktreeOptions?.startPoint;
}

async function retryProvisioningAndWait(args: {
  cellId: string;
  cell: Parameters<typeof insertCellRow>[0];
  provisioning?: Parameters<typeof insertProvisioningStateRow>[1];
  sendAgentMessage?: SendAgentMessageFn;
}) {
  const sendAgentMessage =
    args.sendAgentMessage ?? vi.fn<SendAgentMessageFn>().mockResolvedValue();
  const app = createTestApp({ sendAgentMessage });
  await insertCellRow(args.cell);
  await insertProvisioningStateRow(args.cellId, args.provisioning ?? {});

  const retryResponse = await postSetupRetry(app, args.cellId);
  if (retryResponse.status !== OK_STATUS) {
    throw new Error(
      `Expected status ${OK_STATUS}, got ${retryResponse.status}`
    );
  }
  await waitForCellStatus(args.cellId, "ready");
  return sendAgentMessage;
}

const retryCellValues = (
  cellId: string,
  values: Partial<typeof cells.$inferInsert>
) => ({
  id: cellId,
  opencodeSessionId: null,
  status: "error" as const,
  lastSetupError: "setup failed",
  ...values,
});

const retryPromptCall = (cellId: string, parts: unknown[]) => [
  `session-${cellId}`,
  { parts },
];

describe("POST /api/cells", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(cells);
    removeWorktreeCalls = 0;
  });

  it("returns detailed payload when template setup fails", async () => {
    const failingCommand = "bash -lc 'echo FAIL && exit 42'";
    const cause = new CommandExecutionError({
      command: failingCommand,
      cwd: workspacePath,
      exitCode: 42,
    });
    const setupError = new TemplateSetupError({
      command: failingCommand,
      templateId,
      workspacePath,
      cause,
    });

    const app = createTestApp({ setupError });

    const payload = await createCellAndExpectSpawning({
      app,
      body: defaultCreateBody("Broken Cell"),
    });

    expect(payload.lastSetupError).toBeUndefined();

    expect(removeWorktreeCalls).toBe(0);

    const erroredRow = await waitForCellStatus(payload.id, "error");
    expect(erroredRow.lastSetupError).toContain(
      "Template ID: failing-template"
    );
    expect(erroredRow.lastSetupError).toContain("exit code 42");

    const rows = await testDb.select().from(cells);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("error");
  });

  it("sends the cell title and description as the first agent prompt", async () => {
    const { sendAgentMessage, capturedSessionId } =
      await createPromptDispatchScenario(
        defaultCreateBody("Autostart Cell", {
          description: "  Fix the failing specs in apps/web  ",
        })
      );

    expect(capturedSessionId).toBeTruthy();
    expect(sendAgentMessage).toHaveBeenCalledWith(capturedSessionId, {
      parts: [
        {
          type: "text",
          text: "Autostart Cell\n\nFix the failing specs in apps/web",
        },
      ],
    });
  });

  it("sends image-only initial prompts", async () => {
    const { sendAgentMessage, capturedSessionId } =
      await createPromptDispatchScenario(
        defaultCreateBody("Prompt With Image", {
          initialPromptImages: [TEST_INITIAL_PROMPT_IMAGE],
        })
      );

    expect(sendAgentMessage).toHaveBeenCalledWith(capturedSessionId, {
      parts: [TEST_INITIAL_PROMPT_FILE_PART],
    });
  });

  it("sends text and image parts together in the initial prompt", async () => {
    const { sendAgentMessage, capturedSessionId } =
      await createPromptDispatchScenario(
        defaultCreateBody("Prompt With Image", {
          description: "Inspect this screenshot",
          initialPromptImages: [TEST_INITIAL_PROMPT_IMAGE],
        })
      );

    expect(sendAgentMessage).toHaveBeenCalledWith(capturedSessionId, {
      parts: [
        {
          type: "text",
          text: "Prompt With Image\n\nInspect this screenshot",
        },
        TEST_INITIAL_PROMPT_FILE_PART,
      ],
    });
  });

  it("continues provisioning when the initial prompt is slow", async () => {
    let releasePrompt = () => {
      // replaced once deferred prompt is created
    };
    const sendAgentMessage = vi.fn<SendAgentMessageFn>().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releasePrompt = resolve;
        })
    );

    const app = createTestApp({ sendAgentMessage });

    const payload = await createCellAndExpectSpawning({
      app,
      body: defaultCreateBody("Slow Prompt Dispatch", {
        description: "Investigate startup reliability",
      }),
    });

    await waitForCellStatus(
      payload.id,
      "ready",
      DETACHED_PROMPT_READY_TIMEOUT_MS
    );
    const markReadyStep = await waitForTimingStep(payload.id, "mark_ready");

    expect(markReadyStep.status).toBe("ok");
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);

    releasePrompt();
  });

  it("passes selected model overrides to agent provisioning", async () => {
    const capture = createAgentOverrideCapture();

    const payload = await createCellAndExpectSpawning({
      app: capture.app,
      body: defaultCreateBody("Model Override", {
        modelId: "custom-model",
        providerId: "zen",
      }),
    });

    await waitForCellStatus(payload.id, "ready");
    await waitForCondition(() => Boolean(capture.read()));

    expect(capture.read()).toEqual({
      modelId: "custom-model",
      providerId: "zen",
      startMode: "plan",
    });
  });

  it("passes branch spawn source to worktree creation", async () => {
    const startPoint = await captureCreateWorktreeStartPoint(
      defaultCreateBody("Spawn From Branch", {
        spawnFromMode: "branch",
        spawnFromValue: "feature/my-work",
      })
    );

    expect(startPoint).toEqual({
      mode: "branch",
      value: "feature/my-work",
    });
  });

  it("passes GitHub PR spawn source to worktree creation", async () => {
    const startPoint = await captureCreateWorktreeStartPoint(
      defaultCreateBody("Spawn From PR", {
        spawnFromMode: "pr",
        spawnFromValue: `https://github.com/acme/repo/pull/${TEST_PR_NUMBER}`,
      })
    );

    expect(startPoint).toEqual({
      mode: "pr",
      value: `https://github.com/acme/repo/pull/${TEST_PR_NUMBER}`,
    });
  });

  it("returns 400 when branch spawn source is missing value", async () => {
    const app = createTestApp();

    const response = await postCreateCell(
      app,
      defaultCreateBody("Missing Branch Value", {
        spawnFromMode: "branch",
        spawnFromValue: "   ",
      })
    );

    expect(response.status).toBe(BAD_REQUEST_STATUS);
    expect((await response.json()) as { message: string }).toEqual({
      message: "Branch name is required when spawning from branch",
    });
  });

  it("applies defaults.startMode when create request omits start mode", async () => {
    const capture = createAgentOverrideCapture({
      hiveConfigOverride: {
        ...hiveConfig,
        opencode: {
          ...hiveConfig.opencode,
          defaultMode: undefined,
        },
        defaults: {
          ...hiveConfig.defaults,
          startMode: "build",
        },
      },
    });

    await createCellAndWaitReady({
      app: capture.app,
      body: defaultCreateBody("Defaults Start Mode"),
    });

    await waitForCondition(() => Boolean(capture.read()));

    expect(capture.read()).toEqual({
      startMode: "build",
    });
  });

  it("surfaces model override failures with explicit provisioning errors", async () => {
    const overrideErrorMessage =
      'Selected model override is invalid: model "gpt-5.2-xhigh" is unavailable for provider "opencode".';

    const app = createTestApp({
      onEnsureAgentSession: () => {
        throw new Error(overrideErrorMessage);
      },
    });

    const payload = await createCellAndExpectSpawning({
      app,
      body: defaultCreateBody("Invalid Model Override", {
        modelId: "gpt-5.2-xhigh",
        providerId: "opencode",
      }),
    });

    const erroredRow = await waitForCellStatus(payload.id, "error");
    expect(erroredRow.lastSetupError).toContain(overrideErrorMessage);
  });

  it("skips sending the initial prompt when description is blank", async () => {
    const sendAgentMessage = vi
      .fn<SendAgentMessageFn>()
      .mockResolvedValue(undefined);

    const app = createTestApp({ sendAgentMessage });

    const payload = await createCellAndExpectSpawning({
      app,
      body: defaultCreateBody("Blank Description", {
        description: "   ",
      }),
    });

    await waitForCellStatus(payload.id, "ready");
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("rejects invalid initial prompt images", async () => {
    const app = createTestApp();

    const response = await postCreateCell(
      app,
      defaultCreateBody("Invalid Image", {
        initialPromptImages: [
          {
            filename: "notes.txt",
            mimeType: "text/plain",
            base64Data: "aGVsbG8=",
          },
        ],
      })
    );

    expect(response.status).toBe(BAD_REQUEST_STATUS);
  });

  it("rejects malformed base64 image payloads", async () => {
    const app = createTestApp();

    const response = await postCreateCell(
      app,
      defaultCreateBody("Broken Base64 Image", {
        initialPromptImages: [
          {
            filename: "broken.png",
            mimeType: "image/png",
            base64Data: "abcde",
          },
        ],
      })
    );

    expect(response.status).toBe(BAD_REQUEST_STATUS);
  });

  it("persists create_worktree timing sub-steps while provisioning is still running", async () => {
    let releaseWorktree = () => {
      // replaced when deferred worktree promise is created
    };

    const createWorktree: CreateWorktreeFn = async (_cellId, createOptions) => {
      createOptions?.onTimingEvent?.({
        step: "include_copy_glob_match_start",
        durationMs: 0,
      });

      await new Promise<void>((resolve) => {
        releaseWorktree = resolve;
      });

      createOptions?.onTimingEvent?.({
        step: "include_copy_glob_match",
        durationMs: 15,
      });

      return mockWorktree();
    };

    const app = createTestApp({ createWorktree });

    const payload = await createCellAndExpectSpawning({
      app,
      body: defaultCreateBody("Streaming Worktree Timing"),
    });

    await waitForTimingStep(
      payload.id,
      "create_worktree:include_copy_glob_match_start"
    );

    const timingRowsBeforeRelease = await testDb
      .select()
      .from(cellTimingEvents)
      .where(eq(cellTimingEvents.cellId, payload.id));
    expect(
      timingRowsBeforeRelease.some(
        (row) => row.step === "create_worktree:include_copy_glob_match"
      )
    ).toBe(false);

    releaseWorktree();

    await waitForTimingStep(
      payload.id,
      "create_worktree:include_copy_glob_match"
    );
    await waitForCellStatus(payload.id, "ready");
  });

  it("cancels provisioning when the cell enters deleting state", async () => {
    let releaseWorktree = () => {
      // replaced below once deferred promise is created
    };
    const createWorktree: CreateWorktreeFn = async () => {
      await new Promise<void>((resolve) => {
        releaseWorktree = resolve;
      });

      return mockWorktree();
    };
    const ensureServicesForCell = vi.fn(async () => Promise.resolve());

    const app = createTestApp({
      createWorktree,
      ensureServicesForCell,
    });

    const payload = await createCellAndExpectSpawning({
      app,
      body: defaultCreateBody("Cancel During Delete"),
    });

    const deleteResponse = await deleteCellById(app, payload.id);
    expect(deleteResponse.status).toBe(OK_STATUS);

    releaseWorktree();

    await waitForCondition(async () => {
      const rows = await testDb
        .select({ id: cells.id })
        .from(cells)
        .where(eq(cells.id, payload.id));
      return rows.length === 0;
    });

    expect(ensureServicesForCell).not.toHaveBeenCalled();
  });
});

describe("POST /api/cells/:id/setup/retry", () => {
  beforeEach(async () => {
    await testDb.delete(cells);
  });

  it("does not resend the initial prompt when retrying an existing session", async () => {
    const sendAgentMessage = vi
      .fn<SendAgentMessageFn>()
      .mockResolvedValue(undefined);
    const app = createTestApp({ sendAgentMessage });
    const cellId = "retry-existing-session-cell";

    await insertCellRow({
      id: cellId,
      name: "Retry Existing Session",
      description: "Repeat-safe prompt",
      opencodeSessionId: "session-retry-existing-session-cell",
      status: "error",
      lastSetupError: "setup failed",
    });

    await insertProvisioningStateRow(cellId, {
      attemptCount: 1,
    });

    const retryResponse = await postSetupRetry(app, cellId);
    expect(retryResponse.status).toBe(OK_STATUS);

    await waitForCellStatus(cellId, "ready");
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("sends the initial prompt on retry when no prior session exists", async () => {
    const cellId = "retry-no-session-cell";
    const sendAgentMessage = await retryProvisioningAndWait({
      cellId,
      cell: retryCellValues(cellId, {
        name: "Retry No Session",
        description: "Send this after retry",
      }),
      provisioning: { attemptCount: 1 },
    });

    expect(sendAgentMessage.mock.calls).toEqual([
      retryPromptCall(cellId, [
        { type: "text", text: "Retry No Session\n\nSend this after retry" },
      ]),
    ]);
  });

  it("resends stored initial prompt images on retry when no prior session exists", async () => {
    const cellId = "retry-image-cell";
    const sendAgentMessage = await retryProvisioningAndWait({
      cellId,
      cell: retryCellValues(cellId, {
        name: "Retry Image Cell",
        description: "Use the screenshot",
      }),
      provisioning: {
        attemptCount: 1,
        initialPromptImagesJson: JSON.stringify([TEST_INITIAL_PROMPT_IMAGE]),
      },
    });

    expect(sendAgentMessage.mock.calls).toEqual([
      retryPromptCall(cellId, [
        { type: "text", text: "Retry Image Cell\n\nUse the screenshot" },
        TEST_INITIAL_PROMPT_FILE_PART,
      ]),
    ]);
  });

  it("returns 409 when the cell is being deleted", async () => {
    const app = createTestApp();
    const cellId = "retry-deleting-cell";

    await insertCellRow({
      id: cellId,
      name: "Retry Deleting Cell",
      status: "deleting",
      lastSetupError: "cleanup in progress",
    });

    const retryResponse = await postSetupRetry(app, cellId);
    expect(retryResponse.status).toBe(CONFLICT_STATUS);
    expect((await retryResponse.json()) as { message: string }).toEqual({
      message: "Cell is being deleted",
    });

    const [persisted] = await testDb
      .select({ status: cells.status, lastSetupError: cells.lastSetupError })
      .from(cells)
      .where(eq(cells.id, cellId));

    expect(persisted?.status).toBe("deleting");
    expect(persisted?.lastSetupError).toBe("cleanup in progress");
  });

  it("returns 409 when a retry is already in progress", async () => {
    let releaseEnsureServices = () => {
      // replaced below once the deferred promise is created
    };
    const ensureServicesForCell = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseEnsureServices = resolve;
      });
    });

    const app = createTestApp({ ensureServicesForCell });
    const cellId = "retry-lock-cell";

    await insertCellRow({
      id: cellId,
      name: "Retry Lock Cell",
      description: "Retry lock",
      status: "error",
      lastSetupError: "Setup failed",
    });

    await insertProvisioningStateRow(cellId);

    const firstRetryPromise = postSetupRetry(app, cellId);

    await waitForCondition(() => ensureServicesForCell.mock.calls.length === 1);

    const secondRetryResponse = await postSetupRetry(app, cellId);
    expect(secondRetryResponse.status).toBe(CONFLICT_STATUS);
    expect((await secondRetryResponse.json()) as { message: string }).toEqual({
      message: "Provisioning retry already in progress",
    });

    releaseEnsureServices();

    const firstRetryResponse = await firstRetryPromise;
    expect(firstRetryResponse.status).toBe(OK_STATUS);
    await waitForCellStatus(cellId, "ready");
  });
});

describe("resumeSpawningCells", () => {
  beforeEach(async () => {
    await testDb.delete(cells);
    removeWorktreeCalls = 0;
  });

  it("retries provisioning for stranded cells", async () => {
    const dependencies = createDependencies();
    const cellId = "resume-cell";
    const createdAt = new Date();

    await insertCellRow({
      id: cellId,
      name: "Resume Cell",
      description: "Resume description",
      createdAt,
      status: "spawning",
    });

    await insertProvisioningStateRow(cellId);

    await resumeSpawningCells(dependencies);

    const readyRow = await waitForCellStatus(cellId, "ready");
    const [provisioningState] = await testDb
      .select()
      .from(cellProvisioningStates)
      .where(eq(cellProvisioningStates.cellId, cellId));

    expect(provisioningState?.startedAt).toBeInstanceOf(Date);
    expect(provisioningState?.finishedAt).toBeInstanceOf(Date);
    expect(provisioningState?.attemptCount).toBe(1);
    expect(readyRow.lastSetupError).toBeNull();
  });

  it("marks cells as error when the template no longer exists", async () => {
    const missingTemplateConfig: HiveConfig = {
      ...hiveConfig,
      templates: {},
    };

    const cellId = "missing-template-cell";
    await insertCellRow({
      id: cellId,
      name: "Missing Template",
      templateId: "removed-template",
      status: "spawning",
    });

    await insertProvisioningStateRow(cellId);

    await resumeSpawningCells(
      createDependencies({ hiveConfigOverride: missingTemplateConfig })
    );

    const errored = await waitForCellStatus(cellId, "error");
    expect(errored.lastSetupError).toContain(
      "Template removed-template no longer exists"
    );
  });

  it("resumes deleting cells left behind by interrupted shutdowns", async () => {
    const dependencies = createDependencies();
    const cellId = "stuck-deleting-cell";

    await insertCellRow({
      id: cellId,
      name: "Deleting Cell",
      description: "Interrupted deletion",
      status: "deleting",
    });

    await resumeSpawningCells(dependencies);

    const remaining = await testDb
      .select({ id: cells.id })
      .from(cells)
      .where(eq(cells.id, cellId));

    expect(remaining).toHaveLength(0);
    expect(removeWorktreeCalls).toBe(1);
  });
});
