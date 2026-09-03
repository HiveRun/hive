import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client";
import { Elysia } from "elysia";
import {
  afterAll as afterAllTests,
  afterEach as afterEachTest,
  beforeAll as beforeAllTests,
  beforeEach as beforeEachTest,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  closeAllAgentSessions,
  resetAgentRuntimeDependencies,
  setAgentRuntimeDependencies,
} from "../../agents/service";
import type { HiveConfig } from "../../config/schema";
import { agentsRoutes } from "../../routes/agents";
import { cellProvisioningStates } from "../../schema/cell-provisioning";
import { cells } from "../../schema/cells";
import { setupTestDb, testDb } from "../test-db";

type AppDb = typeof import("../../db").db;

const cellId = "cell-by-cell-model";
let workspacePath = "";
const HTTP_OK = 200;

const hiveConfig: HiveConfig = {
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "template-default",
  },
  promptSources: [],
  templates: {
    "template-basic": {
      id: "template-basic",
      label: "By-cell model template",
      type: "manual",
      agent: {
        providerId: "opencode",
        modelId: "template-default",
      },
    },
  },
  defaults: {},
};

function createMockSession() {
  const now = Date.now();
  return {
    id: "session-by-cell-model",
    time: { created: now, updated: now },
    projectID: "project-by-cell-model",
    location: { directory: workspacePath },
    title: "By-cell model session",
    cost: 0,
    tokens: createEmptyTokenUsage(),
  };
}

function createEmptyTokenUsage() {
  return {
    cache: { read: 0, write: 0 },
    input: 0,
    output: 0,
    reasoning: 0,
  };
}

function createClientStub() {
  const sessionMessages = vi.fn(async () => ({
    data: [] as unknown[],
    cursor: {},
  }));
  const prompt = vi.fn(async () => ({
    id: "inbox-by-cell-model",
    sessionID: "session-by-cell-model",
    delivery: "queue" as const,
    payload: { text: "" },
    type: "user" as const,
    timeCreated: Date.now(),
  }));
  const switchAgent = vi.fn(() => Promise.resolve());
  const switchModel = vi.fn(() => Promise.resolve());
  const createSession = vi.fn(async () => createMockSession());
  const location = {
    directory: workspacePath,
    project: {
      id: "project-by-cell-model",
      directory: workspacePath,
      canonical: workspacePath,
    },
  };
  const models = [
    createModelInfo("big-pickle", "opencode/big-pickle"),
    createModelInfo("template-default", "template-default"),
  ];

  const client = {
    session: {
      active: vi.fn(async () => ({})),
      create: createSession,
      get: vi.fn(async () => createMockSession()),
      inbox: { list: vi.fn(async () => []) },
      interrupt: vi.fn(async () => ({ interrupted: true })),
      prompt,
      remove: vi.fn(() => Promise.resolve()),
      switchAgent,
      switchModel,
    },
    event: {
      subscribe: vi.fn(
        () =>
          (async function* () {
            // no runtime events for this regression
          })() as AsyncGenerator<OpenCodeEvent, void, unknown>
      ),
    },
    form: { list: vi.fn(async () => []) },
    message: { list: sessionMessages },
    model: {
      default: vi.fn(async () => ({ location, data: models[1] })),
      list: vi.fn(async () => ({ location, data: models })),
    },
    permission: {
      list: vi.fn(async () => []),
      reply: vi.fn(() => Promise.resolve()),
    },
    provider: {
      list: vi.fn(async () => ({
        location,
        data: [
          {
            id: "opencode",
            name: "OpenCode",
            activation: "enabled" as const,
            package: "@ai-sdk/opencode",
          },
        ],
      })),
    },
  };

  return {
    client: client as unknown as OpenCodeClient,
    sessionMessages,
    prompt,
    createSession,
    switchAgent,
    switchModel,
  };
}

function createModelInfo(modelID: string, id: string) {
  const identity = { id, modelID, name: modelID, providerID: "opencode" };
  return {
    ...identity,
    enabled: true,
    status: "active" as const,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    limit: { context: 128_000, output: 16_000 },
    variants: [],
    cost: [],
    time: { released: 0 },
  };
}

describe("agents by-cell model capture", () => {
  let switchAgentSpy: ReturnType<typeof vi.fn>;
  let switchModelSpy: ReturnType<typeof vi.fn>;
  let createSessionSpy: ReturnType<typeof vi.fn>;

  beforeAllTests(async () => {
    await setupTestDb();
    workspacePath = await mkdtemp(join(tmpdir(), "hive-by-cell-model-"));
  });

  afterAllTests(async () => {
    await rm(workspacePath, { force: true, recursive: true });
  });

  beforeEachTest(async () => {
    vi.restoreAllMocks();
    await closeAllAgentSessions();
    await testDb.delete(cellProvisioningStates);
    await testDb.delete(cells);

    const { client, createSession, switchAgent, switchModel } =
      createClientStub();
    createSessionSpy = createSession;
    switchAgentSpy = switchAgent;
    switchModelSpy = switchModel;

    setAgentRuntimeDependencies({
      db: testDb as unknown as AppDb,
      loadHiveConfig: vi.fn(async () => hiveConfig),
      loadEffectiveOpencodeDefaults: vi.fn(async () => ({})),
      acquireOpencodeClient: vi.fn(async () => client),
    });

    await testDb.insert(cells).values({
      id: cellId,
      name: "By-cell model capture",
      description: null,
      templateId: "template-basic",
      workspacePath,
      workspaceRootPath: workspacePath,
      workspaceId: "workspace-by-cell-model",
      createdAt: new Date(),
      status: "ready",
      opencodeSessionId: null,
      branchName: "cell-by-cell-model",
      baseCommit: null,
      lastSetupError: null,
    });

    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: "opencode/big-pickle",
      providerIdOverride: "opencode",
      startedAt: null,
      finishedAt: null,
      attemptCount: 0,
    });
  });

  afterEachTest(async () => {
    await closeAllAgentSessions();
    resetAgentRuntimeDependencies();
  });

  it("returns selected model before first user prompt", async () => {
    const app = new Elysia().use(agentsRoutes);

    const response = await app.handle(
      new Request(`http://localhost/api/agents/sessions/byCell/${cellId}`)
    );

    const payload = (await response.json()) as {
      message?: string;
      session: {
        modelId?: string;
        modelProviderId?: string;
      } | null;
    };
    expect(response.status, payload.message).toBe(HTTP_OK);

    expect(payload.session).not.toBeNull();
    expect(payload.session?.modelId).toBe("opencode/big-pickle");
    expect(payload.session?.modelProviderId).toBe("opencode");
    expect(createSessionSpy).toHaveBeenCalledWith({
      title: "By-cell model capture",
      agent: "plan",
      location: { directory: workspacePath },
    });
    expect(switchAgentSpy).not.toHaveBeenCalled();
    expect(switchModelSpy).toHaveBeenCalledWith({
      sessionID: "session-by-cell-model",
      model: {
        providerID: "opencode",
        id: "opencode/big-pickle",
      },
    });
  });
});
