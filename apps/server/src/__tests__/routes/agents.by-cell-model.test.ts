import type { OpencodeClient, Event as OpencodeEvent } from "@opencode-ai/sdk";
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
const workspacePath = "/tmp/by-cell-model";
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
    projectID: "project-by-cell-model",
    directory: workspacePath,
    title: "By-cell model session",
    version: "1",
    time: {
      created: now,
      updated: now,
    },
  };
}

function createClientStub() {
  const sessionMessages = vi.fn(async () => ({ data: [] as unknown[] }));
  const prompt = vi.fn(async () => ({ error: null }));

  const client = {
    session: {
      create: vi.fn(async () => ({ data: createMockSession() })),
      delete: vi.fn(async () => ({ error: null })),
      get: vi.fn(async () => ({ data: createMockSession() })),
      messages: sessionMessages,
      prompt,
    },
    event: {
      subscribe: vi.fn(async () => ({
        stream: (async function* () {
          // no runtime events for this regression
        })() as AsyncGenerator<OpencodeEvent, void, unknown>,
      })),
    },
    config: {
      providers: vi.fn(async () => ({
        data: {
          providers: [
            {
              id: "opencode",
              models: {
                "big-pickle": { id: "opencode/big-pickle" },
                "template-default": { id: "template-default" },
              },
            },
          ],
          default: { opencode: "template-default" },
        },
      })),
    },
    postSessionIdPermissionsPermissionId: vi.fn(async () => ({
      error: null,
    })),
  };

  return {
    client: client as unknown as OpencodeClient,
    sessionMessages,
    prompt,
  };
}

describe("agents by-cell model capture", () => {
  let promptSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await closeAllAgentSessions();
    await testDb.delete(cellProvisioningStates);
    await testDb.delete(cells);

    const { client, prompt } = createClientStub();
    promptSpy = prompt;

    setAgentRuntimeDependencies({
      db: testDb as unknown as AppDb,
      loadHiveConfig: vi.fn(async () => hiveConfig),
      loadOpencodeConfig: vi.fn(async () => ({
        config: {},
        source: "default" as const,
      })),
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

  afterEach(async () => {
    await closeAllAgentSessions();
    resetAgentRuntimeDependencies();
  });

  it("returns selected model before first user prompt", async () => {
    const app = new Elysia().use(agentsRoutes);

    const response = await app.handle(
      new Request(`http://localhost/api/agents/sessions/byCell/${cellId}`)
    );

    expect(response.status).toBe(HTTP_OK);
    const payload = (await response.json()) as {
      session: {
        modelId?: string;
        modelProviderId?: string;
      } | null;
    };

    expect(payload.session).not.toBeNull();
    expect(payload.session?.modelId).toBe("big-pickle");
    expect(payload.session?.modelProviderId).toBe("opencode");
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy).toHaveBeenCalledWith({
      path: { id: "session-by-cell-model" },
      query: { directory: workspacePath },
      body: {
        noReply: true,
        model: {
          providerID: "opencode",
          modelID: "big-pickle",
        },
        parts: [],
      },
    });
  });
});
