import type { OpencodeClient, Event as OpencodeEvent } from "@opencode-ai/sdk";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { setupTestDb, testDb } from "../__tests__/test-db";
import type { HiveConfig } from "../config/schema";
import { cellProvisioningStates } from "../schema/cell-provisioning";
import { cells } from "../schema/cells";
// biome-ignore lint/performance/noNamespaceImport: tests need namespace import for spies
import * as OpencodeConfig from "./opencode-config";

type AppDb = typeof import("../db").db;

type ClientStub = {
  session: {
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
  };
  event: {
    subscribe: ReturnType<typeof vi.fn>;
  };
  config: {
    providers: ReturnType<typeof vi.fn>;
  };
  postSessionIdPermissionsPermissionId: ReturnType<typeof vi.fn>;
};

const sessionMessagesMock = vi
  .fn()
  .mockResolvedValue({ data: [] as unknown[] });

const mockHiveConfig: HiveConfig = {
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "template-default",
  },
  promptSources: [],
  templates: {
    "template-basic": {
      id: "template-basic",
      label: "Test Template",
      type: "manual",
      agent: {
        providerId: "opencode",
        modelId: "template-default",
      },
    },
  },
  defaults: {},
};

import {
  closeAllAgentSessions,
  ensureAgentSession,
  fetchCompactionStats,
  resetAgentRuntimeDependencies,
  sendAgentMessage,
  setAgentRuntimeDependencies,
  updateAgentSessionModel,
} from "./service";

describe("agent model selection", () => {
  const cellId = "cell-model-test";
  let clientStub: ClientStub;
  let loadHiveConfigMock: Mock;
  let loadOpencodeConfigSpy: Mock;
  let acquireOpencodeClientMock: Mock;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();

    clientStub = buildClientStub();
    acquireOpencodeClientMock = vi.fn(
      async () => clientStub as unknown as OpencodeClient
    );

    loadHiveConfigMock = vi.fn(async () => mockHiveConfig);
    loadOpencodeConfigSpy = vi
      .spyOn(OpencodeConfig, "loadOpencodeConfig")
      .mockResolvedValue({
        config: {},
        source: "default",
      });

    setAgentRuntimeDependencies({
      db: testDb as unknown as AppDb,
      loadHiveConfig: loadHiveConfigMock,
      loadOpencodeConfig: loadOpencodeConfigSpy,
      acquireOpencodeClient: acquireOpencodeClientMock,
    });

    await closeAllAgentSessions();
    await testDb.delete(cellProvisioningStates);
    await testDb.delete(cells);
    sessionMessagesMock.mockReset();
    sessionMessagesMock.mockResolvedValue({ data: [] });

    await testDb.insert(cells).values({
      id: cellId,
      name: "Model Test Cell",
      description: "",
      templateId: "template-basic",
      workspacePath: "/tmp/model-test",
      workspaceId: "workspace-1",
      workspaceRootPath: "/tmp/model-test",
      createdAt: new Date(),
      status: "ready",
    });
  });

  afterEach(() => {
    resetAgentRuntimeDependencies();
  });

  it("hydrates runtime model from the last user message", async () => {
    sessionMessagesMock.mockResolvedValueOnce({
      data: [
        {
          info: {
            id: "msg-user",
            sessionID: "session-restored",
            role: "user",
            time: {
              created: Date.now(),
              updated: Date.now(),
            },
            model: {
              providerID: "opencode",
              modelID: "restored-model",
            },
          },
          parts: [],
        },
      ],
    });

    const session = await ensureAgentSession(cellId);

    expect(session.modelId).toBe("restored-model");
    expect(session.modelProviderId).toBe("opencode");
    expect(sessionMessagesMock).toHaveBeenCalled();
  });

  it("sends prompts using the updated provider/model selection", async () => {
    sessionMessagesMock.mockResolvedValue({
      data: [
        {
          info: {
            id: "msg-user",
            sessionID: "session-switch",
            role: "user",
            time: {
              created: Date.now(),
              updated: Date.now(),
            },
            model: {
              providerID: "opencode",
              modelID: "restored-model",
            },
          },
          parts: [],
        },
      ],
    });

    const session = await ensureAgentSession(cellId);

    await updateAgentSessionModel(session.id, {
      modelId: "big-pickle",
      providerId: "opencode",
    });

    await sendAgentMessage(session.id, "Run task with new model");

    const promptCall = clientStub.session.prompt.mock.calls.at(-1);
    expect(promptCall).toBeDefined();
    const promptPayload = (
      promptCall?.[0] as {
        body?: { model?: { providerID: string; modelID: string } };
      }
    )?.body;
    expect(promptPayload?.model).toEqual({
      providerID: "opencode",
      modelID: "big-pickle",
    });
  });

  it("prefers the template's agent configuration over opencode defaults", async () => {
    loadOpencodeConfigSpy.mockResolvedValue({
      config: { model: "openai/gpt-5.1-codex-high" },
      source: "workspace",
      details: undefined,
      defaultModel: { providerId: "openai", modelId: "gpt-5.1-codex-high" },
    });

    clientStub.config.providers.mockResolvedValue({
      data: {
        providers: [
          {
            id: "opencode",
            models: {
              "template-default": { id: "template-default" },
            },
          },
        ],
        default: { opencode: "template-default" },
      },
    });

    const session = await ensureAgentSession(cellId);

    expect(session.provider).toBe("opencode");
    expect(session.modelId).toBe("template-default");
  });

  it("uses workspace defaults when template agents omit models and providers match", async () => {
    const baseTemplate = mockHiveConfig.templates["template-basic"];
    if (!baseTemplate) {
      throw new Error("Test template missing");
    }

    const hiveConfigWithoutModel: HiveConfig = {
      ...mockHiveConfig,
      templates: {
        ...mockHiveConfig.templates,
        "template-basic": {
          ...baseTemplate,
          agent: {
            providerId: "opencode",
          },
        },
      },
    };

    loadHiveConfigMock.mockResolvedValue(hiveConfigWithoutModel);
    loadOpencodeConfigSpy.mockResolvedValue({
      config: { model: "opencode/workspace-default" },
      source: "workspace",
      details: undefined,
      defaultModel: { providerId: "opencode", modelId: "workspace-default" },
    });

    clientStub.config.providers.mockResolvedValue({
      data: {
        providers: [
          {
            id: "opencode",
            models: {
              "workspace-default": { id: "workspace-default" },
            },
          },
        ],
        default: { opencode: "workspace-default" },
      },
    });

    const session = await ensureAgentSession(cellId);

    expect(session.provider).toBe("opencode");
    expect(session.modelId).toBe("workspace-default");
  });

  it("falls back to hive defaults when workspace defaults target another provider", async () => {
    const baseTemplate = mockHiveConfig.templates["template-basic"];
    if (!baseTemplate) {
      throw new Error("Test template missing");
    }

    const hiveConfigWithoutModel: HiveConfig = {
      ...mockHiveConfig,
      templates: {
        ...mockHiveConfig.templates,
        "template-basic": {
          ...baseTemplate,
          agent: {
            providerId: "opencode",
          },
        },
      },
    };

    loadHiveConfigMock.mockResolvedValue(hiveConfigWithoutModel);
    loadOpencodeConfigSpy.mockResolvedValue({
      config: { model: "opencode/workspace-default" },
      source: "workspace",
      details: undefined,
      defaultModel: { providerId: "openai", modelId: "gpt-5.1-codex-high" },
    });

    const session = await ensureAgentSession(cellId);

    expect(session.provider).toBe("opencode");
    expect(session.modelId).toBe("template-default");
  });

  it("accepts explicit model override when it matches provider model id", async () => {
    clientStub.config.providers.mockResolvedValue({
      data: {
        providers: [
          {
            id: "opencode",
            models: {
              "gpt-5.3-codex": { id: "opencode/gpt-5.3-codex" },
              "template-default": { id: "template-default" },
            },
          },
        ],
        default: { opencode: "template-default" },
      },
    });

    const session = await ensureAgentSession(cellId, {
      modelId: "opencode/gpt-5.3-codex",
      providerId: "opencode",
    });

    expect(session.provider).toBe("opencode");
    expect(session.modelId).toBe("gpt-5.3-codex");
    expect(clientStub.session.prompt).toHaveBeenCalledWith({
      path: { id: session.id },
      query: { directory: "/tmp/model-test" },
      body: {
        noReply: true,
        model: {
          providerID: "opencode",
          modelID: "gpt-5.3-codex",
        },
        parts: [],
      },
    });
  });

  it("reuses persisted provisioning model overrides before first message", async () => {
    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: "opencode/gpt-5.3-codex",
      providerIdOverride: "opencode",
    });

    clientStub.config.providers.mockResolvedValue({
      data: {
        providers: [
          {
            id: "opencode",
            models: {
              "gpt-5.3-codex": { id: "opencode/gpt-5.3-codex" },
              "template-default": { id: "template-default" },
            },
          },
        ],
        default: { opencode: "template-default" },
      },
    });

    const session = await ensureAgentSession(cellId);

    expect(session.provider).toBe("opencode");
    expect(session.modelId).toBe("gpt-5.3-codex");
    expect(clientStub.session.prompt).toHaveBeenCalledWith({
      path: { id: session.id },
      query: { directory: "/tmp/model-test" },
      body: {
        noReply: true,
        model: {
          providerID: "opencode",
          modelID: "gpt-5.3-codex",
        },
        parts: [],
      },
    });
  });

  it("throws clear errors for invalid persisted model overrides", async () => {
    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: "gpt-5.2-xhigh",
      providerIdOverride: "opencode",
    });

    const availableModel = "minimax-m2.1";
    clientStub.config.providers.mockResolvedValue({
      data: {
        providers: [
          {
            id: "opencode",
            models: {
              [availableModel]: { id: availableModel },
            },
          },
        ],
        default: { opencode: availableModel },
      },
    });

    await expect(ensureAgentSession(cellId)).rejects.toThrow(
      `Selected model override is invalid: model "gpt-5.2-xhigh" is unavailable for provider "opencode". Available models: ${availableModel}. Refresh the model catalog and try again.`
    );
  });

  it("throws clear errors for invalid explicit model overrides", async () => {
    const baseTemplate = mockHiveConfig.templates["template-basic"];
    if (!baseTemplate) {
      throw new Error("Test template missing");
    }

    const hiveConfigWithoutModel: HiveConfig = {
      ...mockHiveConfig,
      templates: {
        ...mockHiveConfig.templates,
        "template-basic": {
          ...baseTemplate,
          agent: {
            providerId: "opencode",
          },
        },
      },
    };

    loadHiveConfigMock.mockResolvedValue(hiveConfigWithoutModel);
    loadOpencodeConfigSpy.mockResolvedValue({
      config: { model: "opencode/gpt-5.2-xhigh" },
      source: "workspace",
      details: undefined,
      defaultModel: { providerId: "opencode", modelId: "gpt-5.2-xhigh" },
    });

    const defaultFallbackModel = "minimax-m2.1";
    clientStub.config.providers.mockResolvedValue({
      data: {
        providers: [
          {
            id: "opencode",
            models: {
              [defaultFallbackModel]: { id: defaultFallbackModel },
            },
          },
        ],
        default: { opencode: defaultFallbackModel },
      },
    });

    await expect(
      ensureAgentSession(cellId, {
        modelId: "gpt-5.2-xhigh",
        providerId: "opencode",
      })
    ).rejects.toThrow(
      `Selected model override is invalid: model "gpt-5.2-xhigh" is unavailable for provider "opencode". Available models: ${defaultFallbackModel}. Refresh the model catalog and try again.`
    );
  });

  it("tracks compaction events and exposes stats", async () => {
    const compactionEvent: OpencodeEvent = {
      type: "session.compacted",
      properties: { sessionID: "session-runtime" },
    };
    const published: unknown[] = [];
    const clientStubWithEvents = buildClientStubWithEvents([compactionEvent]);

    acquireOpencodeClientMock = vi.fn(
      async () => clientStubWithEvents as unknown as OpencodeClient
    );

    setAgentRuntimeDependencies({
      acquireOpencodeClient: acquireOpencodeClientMock,
      publishAgentEvent: (sessionId, event) => {
        if (sessionId === "session-runtime") {
          published.push(event);
        }
      },
    });

    const session = await ensureAgentSession(cellId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stats = await fetchCompactionStats(session.id);

    expect(stats.count).toBe(1);
    expect(
      published.some(
        (event) => (event as { type?: string }).type === "session.compaction"
      )
    ).toBe(true);
  });

  it("deletes remote opencode session when runtime stops", async () => {
    const session = await ensureAgentSession(cellId);

    await closeAllAgentSessions();

    expect(clientStub.session.delete).toHaveBeenCalledWith({
      path: { id: session.id },
      query: { directory: "/tmp/model-test" },
    });
  });

  it("ignores missing session errors during runtime shutdown", async () => {
    clientStub.session.delete.mockResolvedValue({
      error: { message: "session not found" },
    });

    await ensureAgentSession(cellId);

    await expect(closeAllAgentSessions()).resolves.toBeUndefined();
    expect(clientStub.session.delete).toHaveBeenCalled();
  });
});

function buildClientStub(): ClientStub {
  const session = {
    create: vi.fn(async () => ({ data: createMockSession() })),
    delete: vi.fn(async () => ({ error: null })),
    get: vi.fn(async () => ({ data: createMockSession() })),
    messages: sessionMessagesMock,
    prompt: vi.fn(async () => ({ error: null })),
  };

  return {
    session,
    event: {
      subscribe: vi.fn(async () => ({
        stream: (async function* () {
          // noop stream
        })(),
      })),
    },
    config: {
      providers: vi.fn(async () => ({
        data: { providers: [], default: {} },
      })),
    },
    postSessionIdPermissionsPermissionId: vi.fn(async () => ({
      error: null,
    })),
  };
}

function buildClientStubWithEvents(events: OpencodeEvent[]): ClientStub {
  const stub = buildClientStub();
  stub.event.subscribe = vi.fn(async () => ({
    stream: (function* () {
      for (const event of events) {
        yield event;
      }
    })(),
  }));
  return stub;
}

function createMockSession() {
  const now = Date.now();
  return {
    id: "session-runtime",
    projectID: "project-1",
    directory: "/tmp/model-test",
    title: "Mock Session",
    version: "1",
    time: {
      created: now,
      updated: now,
    },
  };
}
