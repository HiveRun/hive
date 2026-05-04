import type { OpencodeClient, Event as OpencodeEvent } from "@opencode-ai/sdk";
import { eq } from "drizzle-orm";

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

const TEST_CELL_ID = "cell-model-test";
const TEST_WORKSPACE_PATH = "/tmp/model-test";
const TEST_PROVIDER_ID = "opencode";
const TEMPLATE_ID = "template-basic";
const TEMPLATE_MODEL_ID = "template-default";
const CODEX_MODEL_ID = "gpt-5.3-codex";
const CODEX_MODEL_PATH = `${TEST_PROVIDER_ID}/${CODEX_MODEL_ID}`;
const INVALID_MODEL_ID = "gpt-5.2-xhigh";
const FALLBACK_MODEL_ID = "minimax-m2.1";
const RUNTIME_SESSION_ID = "session-runtime";

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
    defaultProvider: TEST_PROVIDER_ID,
    defaultModel: TEMPLATE_MODEL_ID,
  },
  promptSources: [],
  templates: {
    [TEMPLATE_ID]: {
      id: TEMPLATE_ID,
      label: "Test Template",
      type: "manual",
      agent: {
        providerId: TEST_PROVIDER_ID,
        modelId: TEMPLATE_MODEL_ID,
      },
    },
  },
  defaults: {},
};

import {
  closeAgentSession,
  closeAllAgentSessions,
  ensureAgentSession,
  fetchAgentSession,
  fetchAgentSessionForCell,
  fetchCompactionStats,
  resetAgentRuntimeDependencies,
  resumeAgentSessionsOnStartup,
  sendAgentMessage,
  setAgentRuntimeDependencies,
  updateAgentSessionModel,
} from "./service";

describe("agent model selection", () => {
  const cellId = TEST_CELL_ID;
  let clientStub: ClientStub;
  let loadHiveConfigMock: Mock;
  let loadEffectiveOpencodeDefaultsSpy: Mock;
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
    loadEffectiveOpencodeDefaultsSpy = vi
      .spyOn(OpencodeConfig, "loadEffectiveOpencodeDefaults")
      .mockResolvedValue({});

    setAgentRuntimeDependencies({
      db: testDb as unknown as AppDb,
      loadHiveConfig: loadHiveConfigMock,
      loadEffectiveOpencodeDefaults: loadEffectiveOpencodeDefaultsSpy,
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
      templateId: TEMPLATE_ID,
      workspacePath: TEST_WORKSPACE_PATH,
      workspaceId: "workspace-1",
      workspaceRootPath: TEST_WORKSPACE_PATH,
      createdAt: new Date(),
      status: "ready",
    });
  });

  afterEach(() => {
    resetAgentRuntimeDependencies();
    vi.restoreAllMocks();
  });

  async function expectRuntimeStartupAfterSeedFailure(
    message: string,
    failSeed: () => void
  ) {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((..._args) => null);

    failSeed();
    clientStub.config.providers.mockResolvedValue(createCodexProviderCatalog());

    const session = await ensureCodexBuildSession();

    expectSessionModel(session, TEST_PROVIDER_ID, CODEX_MODEL_ID);
    expectSeedWarning(warnSpy, session.id, message);
  }

  function useEventsClient(events: OpencodeEvent[]) {
    const clientStubWithEvents = buildClientStubWithEvents(events);
    useClientStub(clientStubWithEvents);
  }

  function useClientStub(stub: ClientStub, published?: unknown[]) {
    acquireOpencodeClientMock = vi.fn(
      async () => stub as unknown as OpencodeClient
    );

    setAgentRuntimeDependencies({
      db: testDb as unknown as AppDb,
      loadHiveConfig: loadHiveConfigMock,
      loadEffectiveOpencodeDefaults: loadEffectiveOpencodeDefaultsSpy,
      acquireOpencodeClient: acquireOpencodeClientMock,
      ...(published
        ? {
            publishAgentEvent: (sessionId, event) => {
              if (sessionId === RUNTIME_SESSION_ID) {
                published.push(event);
              }
            },
          }
        : {}),
    });
  }

  function ensureCodexBuildSession() {
    return ensureAgentSession(cellId, {
      modelId: CODEX_MODEL_PATH,
      providerId: TEST_PROVIDER_ID,
      startMode: "build",
    });
  }

  function mockTemplateAgentDefaults(providerId: string, modelId: string) {
    loadHiveConfigMock.mockResolvedValue(
      createHiveConfigWithTemplateAgent({ providerId: TEST_PROVIDER_ID })
    );
    loadEffectiveOpencodeDefaultsSpy.mockResolvedValue({
      defaultModel: { providerId, modelId },
    });
  }

  async function startPlanAfterQuestionAnswer(targetCellId: string) {
    useEventsClient([createQuestionRepliedEvent()]);
    await ensureAgentSession(targetCellId, { startMode: "plan" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("hydrates runtime model from the last user message", async () => {
    sessionMessagesMock.mockResolvedValueOnce({
      data: [
        createHistoryMessage({
          id: "msg-user",
          sessionId: "session-restored",
          role: "user",
          modelId: "restored-model",
        }),
      ],
    });

    const session = await ensureAgentSession(cellId);

    expect(session.modelId).toBe("restored-model");
    expect(session.modelProviderId).toBe(TEST_PROVIDER_ID);
    expect(sessionMessagesMock).toHaveBeenCalled();
  });

  it("sends prompts using the updated provider/model selection", async () => {
    sessionMessagesMock.mockResolvedValue(
      createMessagesResponse(
        createHistoryMessage({
          id: "msg-user",
          sessionId: "session-switch",
          role: "user",
          modelId: "restored-model",
        })
      )
    );

    const session = await ensureAgentSession(cellId);

    await updateAgentSessionModel(session.id, {
      modelId: "big-pickle",
      providerId: TEST_PROVIDER_ID,
    });

    await sendAgentMessage(session.id, "Run task with new model");

    const promptPayload = getLastPromptBody<{
      model?: { providerID: string; modelID: string };
    }>(clientStub);
    expect(promptPayload?.model).toEqual(
      createModel(TEST_PROVIDER_ID, "big-pickle")
    );
  });

  it("passes variants through when sending prompts", async () => {
    const session = await ensureAgentSession(cellId);

    await updateAgentSessionModel(session.id, {
      modelId: "big-pickle",
      providerId: TEST_PROVIDER_ID,
      variant: "high",
    });

    const updated = await fetchAgentSession(session.id);
    expect(updated?.modelVariant).toBe("high");

    await sendAgentMessage(session.id, "Run task with variant");

    const promptPayload = getLastPromptBody<{
      model?: { providerID: string; modelID: string };
      variant?: string;
    }>(clientStub);

    expect(promptPayload?.model).toEqual(
      createModel(TEST_PROVIDER_ID, "big-pickle")
    );
    expect(promptPayload?.variant).toBe("high");
  });

  it("prefers the template's agent configuration over opencode defaults", async () => {
    loadEffectiveOpencodeDefaultsSpy.mockResolvedValue({
      defaultModel: { providerId: "openai", modelId: "gpt-5.1-codex-high" },
    });

    clientStub.config.providers.mockResolvedValue(
      createProviderCatalog(
        TEST_PROVIDER_ID,
        { [TEMPLATE_MODEL_ID]: TEMPLATE_MODEL_ID },
        TEMPLATE_MODEL_ID
      )
    );

    const session = await ensureAgentSession(cellId);

    expectSessionModel(session, TEST_PROVIDER_ID, TEMPLATE_MODEL_ID);
  });

  it("defers to OpenCode defaults when template agents omit models and providers match", async () => {
    loadHiveConfigMock.mockResolvedValue(
      createHiveConfigWithTemplateAgent({ providerId: TEST_PROVIDER_ID })
    );
    loadEffectiveOpencodeDefaultsSpy.mockResolvedValue({
      defaultModel: {
        providerId: TEST_PROVIDER_ID,
        modelId: "workspace-default",
      },
    });

    clientStub.config.providers.mockResolvedValue(
      createProviderCatalog(
        TEST_PROVIDER_ID,
        { "workspace-default": "workspace-default" },
        "workspace-default"
      )
    );

    const session = await ensureAgentSession(cellId);

    expect(session.provider).toBeUndefined();
    expect(session.modelId).toBeUndefined();
  });

  it("does not force an explicit model when using OpenCode defaults", async () => {
    loadHiveConfigMock.mockResolvedValue(
      createHiveConfigWithTemplateAgent(
        { providerId: TEST_PROVIDER_ID },
        { opencode: {} }
      )
    );
    loadEffectiveOpencodeDefaultsSpy.mockResolvedValue({
      defaultModel: { providerId: "openai", modelId: "gpt-5.4" },
    });

    clientStub.config.providers.mockResolvedValue(
      createMultiProviderCatalog(
        [
          { id: "openai", models: { "gpt-5.4": "gpt-5.4" } },
          {
            id: TEST_PROVIDER_ID,
            models: { [TEMPLATE_MODEL_ID]: TEMPLATE_MODEL_ID },
          },
        ],
        { openai: "gpt-5.4" }
      )
    );

    const session = await ensureAgentSession(cellId, { startMode: "build" });
    await sendAgentMessage(session.id, "Reply with ok");

    const promptPayload = getLastPromptBody<{ model?: unknown }>(clientStub);

    expect(promptPayload?.model).toBeUndefined();
  });

  it("passes file parts through when sending prompts", async () => {
    const session = await ensureAgentSession(cellId);

    await sendAgentMessage(session.id, {
      parts: [
        { type: "text", text: "Inspect the screenshot" },
        {
          type: "file",
          mime: "image/png",
          filename: "cell.png",
          url: "data:image/png;base64,aGVsbG8=",
        },
      ],
    });

    const promptPayload = getLastPromptBody<{
      parts?: Record<string, unknown>[];
    }>(clientStub);

    expect(promptPayload?.parts).toEqual([
      { type: "text", text: "Inspect the screenshot" },
      {
        type: "file",
        mime: "image/png",
        filename: "cell.png",
        url: "data:image/png;base64,aGVsbG8=",
      },
    ]);
  });

  it("falls back to hive defaults when workspace defaults target another provider", async () => {
    mockTemplateAgentDefaults("openai", "gpt-5.1-codex-high");

    const session = await ensureAgentSession(cellId);

    expectSessionModel(session, TEST_PROVIDER_ID, TEMPLATE_MODEL_ID);
  });

  it("accepts explicit model override when it matches provider model id", async () => {
    clientStub.config.providers.mockResolvedValue(createCodexProviderCatalog());

    const session = await ensureCodexBuildSession();

    expectSessionModel(session, TEST_PROVIDER_ID, CODEX_MODEL_ID);
    expectSeedPromptForModel(clientStub, session.id, CODEX_MODEL_ID);
  });

  it("keeps explicit plan-mode model overrides when restored history reports another model", async () => {
    sessionMessagesMock.mockResolvedValueOnce(
      createMessagesResponse(
        createHistoryMessage({
          id: "msg-prime",
          role: "user",
          modelId: CODEX_MODEL_ID,
        })
      )
    );

    clientStub.config.providers.mockResolvedValue(
      createProviderCatalog(
        TEST_PROVIDER_ID,
        {
          [CODEX_MODEL_ID]: CODEX_MODEL_PATH,
          "glm-5": "opencode/glm-5",
        },
        CODEX_MODEL_ID
      )
    );

    const session = await ensureAgentSession(cellId, {
      modelId: "opencode/glm-5",
      providerId: TEST_PROVIDER_ID,
      startMode: "plan",
    });

    expectSessionModel(session, TEST_PROVIDER_ID, "glm-5");
    expect(clientStub.session.prompt).toHaveBeenNthCalledWith(1, {
      path: { id: session.id },
      query: { directory: TEST_WORKSPACE_PATH },
      body: {
        agent: "plan",
        noReply: true,
        model: createModel(TEST_PROVIDER_ID, "glm-5"),
        parts: [
          {
            type: "text",
            text: "",
          },
        ],
      },
    });
    expect(clientStub.session.prompt).toHaveBeenNthCalledWith(2, {
      path: { id: session.id },
      query: { directory: TEST_WORKSPACE_PATH },
      body: {
        noReply: true,
        model: createModel(TEST_PROVIDER_ID, "glm-5"),
        parts: [],
      },
    });
  });

  it("keeps runtime startup available when model seeding returns rpc errors", async () => {
    await expectRuntimeStartupAfterSeedFailure("seed unavailable", () => {
      clientStub.session.prompt.mockResolvedValueOnce({
        error: { message: "seed unavailable" },
      });
    });
  });

  it("keeps runtime startup available when model seeding throws", async () => {
    await expectRuntimeStartupAfterSeedFailure("socket closed", () => {
      clientStub.session.prompt.mockRejectedValueOnce(
        new Error("socket closed")
      );
    });
  });

  it("skips stale provisioning overrides for restorable sessions", async () => {
    await testDb
      .update(cells)
      .set({ opencodeSessionId: RUNTIME_SESSION_ID })
      .where(eq(cells.id, cellId));

    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: "opencode/stale-model",
      providerIdOverride: TEST_PROVIDER_ID,
    });

    sessionMessagesMock.mockRejectedValueOnce(
      new Error("messages unavailable")
    );

    clientStub.config.providers.mockResolvedValue(
      createTemplateProviderCatalog()
    );

    const session = await ensureAgentSession(cellId);

    expectSessionModel(session, TEST_PROVIDER_ID, TEMPLATE_MODEL_ID);
    expect(clientStub.session.create).not.toHaveBeenCalled();
    expect(clientStub.session.prompt).not.toHaveBeenCalled();
  });

  it("reuses persisted provisioning model overrides before first message", async () => {
    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: CODEX_MODEL_PATH,
      providerIdOverride: TEST_PROVIDER_ID,
    });

    clientStub.config.providers.mockResolvedValue(createCodexProviderCatalog());

    const session = await ensureAgentSession(cellId);

    expectSessionModel(session, TEST_PROVIDER_ID, CODEX_MODEL_ID);
    expectSeedPromptForModel(clientStub, session.id, CODEX_MODEL_ID);
  });

  it("throws clear errors for invalid persisted model overrides", async () => {
    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: INVALID_MODEL_ID,
      providerIdOverride: TEST_PROVIDER_ID,
    });

    clientStub.config.providers.mockResolvedValue(
      createFallbackProviderCatalog()
    );

    await expectInvalidOverrideError(ensureAgentSession(cellId));
  });

  it("throws clear errors for invalid explicit model overrides", async () => {
    mockTemplateAgentDefaults(TEST_PROVIDER_ID, INVALID_MODEL_ID);

    clientStub.config.providers.mockResolvedValue(
      createFallbackProviderCatalog()
    );

    await expectInvalidOverrideError(
      ensureAgentSession(cellId, {
        modelId: INVALID_MODEL_ID,
        providerId: TEST_PROVIDER_ID,
      })
    );
  });

  it("tracks compaction events and exposes stats", async () => {
    const compactionEvent: OpencodeEvent = {
      type: "session.compacted",
      properties: { sessionID: RUNTIME_SESSION_ID },
    };
    const published: unknown[] = [];
    const clientStubWithEvents = buildClientStubWithEvents([compactionEvent]);
    useClientStub(clientStubWithEvents, published);

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

  it("tracks mode transitions from plan to build", async () => {
    const modeEvent = {
      type: "message.updated",
      properties: {
        info: {
          sessionID: RUNTIME_SESSION_ID,
          role: "assistant",
          mode: "build",
        },
      },
    } as unknown as OpencodeEvent;

    const published: unknown[] = [];
    const clientStubWithEvents = buildClientStub();
    let releaseBuildEvent: (() => void) | undefined;
    const emitBuildEvent = new Promise<void>((resolve) => {
      releaseBuildEvent = resolve;
    });
    clientStubWithEvents.event.subscribe = vi.fn(async () => ({
      stream: (async function* () {
        await emitBuildEvent;
        yield modeEvent;
      })(),
    }));

    useClientStub(clientStubWithEvents, published);

    const initial = await ensureAgentSession(cellId, { startMode: "plan" });
    expect(initial.startMode).toBe("plan");
    expect(initial.currentMode).toBe("plan");

    releaseBuildEvent?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const updated = await ensureAgentSession(cellId);
    expect(updated.startMode).toBe("plan");
    expect(updated.currentMode).toBe("build");
    expect(
      published.some(
        (event) =>
          (event as { type?: string; currentMode?: string }).type === "mode" &&
          (event as { currentMode?: string }).currentMode === "build"
      )
    ).toBe(true);
  });

  it("resyncs mode from message history on cell session fetch", async () => {
    sessionMessagesMock.mockResolvedValue(
      createMessagesResponse(
        createHistoryMessage({
          id: "msg-assistant",
          role: "assistant",
          mode: "build",
          completed: true,
        })
      )
    );

    await ensureAgentSession(cellId, { startMode: "plan" });

    const session = await fetchAgentSessionForCell(cellId);

    expect(session).not.toBeNull();
    expect(session?.currentMode).toBe("build");
    expect(sessionMessagesMock).toHaveBeenCalled();
  });

  it("persists resumable working state when a plan question is answered", async () => {
    await startPlanAfterQuestionAnswer(cellId);

    await expectResumeOnStartup(cellId);
  });

  it("restores working status from persisted resume state when remote history lags", async () => {
    const session = await preparePersistedResumeSession();

    const restored = await fetchAgentSession(session.id);

    expect(restored?.status).toBe("working");
  });

  it("resumes flagged sessions on startup even before assistant streaming resumes", async () => {
    const session = await preparePersistedResumeSession();

    clientStub.session.prompt.mockClear();

    await resumeAgentSessionsOnStartup();

    expectContinuePrompt(clientStub, session.id);

    await expectResumeOnStartup(cellId);
  });

  it("keeps persisted resume state when shutting down without deleting the remote session", async () => {
    await startPlanAfterQuestionAnswer(cellId);

    await closeAllAgentSessions({ deleteRemote: false });

    await expectResumeOnStartup(cellId);
  });

  it("deletes remote opencode session when runtime stops", async () => {
    const session = await ensureAgentSession(cellId);

    await closeAllAgentSessions({ deleteRemote: true });

    expectRemoteSessionDelete(clientStub, session.id);
  });

  it("keeps remote opencode session when shutdown preserves sessions", async () => {
    await ensureAgentSession(cellId);

    await closeAllAgentSessions({ deleteRemote: false });

    expect(clientStub.session.delete).not.toHaveBeenCalled();
  });

  it("ignores missing session errors during runtime shutdown", async () => {
    clientStub.session.delete.mockResolvedValue({
      error: { message: "session not found" },
    });

    await ensureAgentSession(cellId);

    await expect(
      closeAllAgentSessions({ deleteRemote: true })
    ).resolves.toBeUndefined();
    expect(clientStub.session.delete).toHaveBeenCalled();
  });

  it("deletes persisted sessions after shutdown when runtime map is empty", async () => {
    const session = await ensureAgentSession(cellId);

    await closeAllAgentSessions({ deleteRemote: false });
    clientStub.session.delete.mockClear();

    await closeAgentSession(cellId);

    expectRemoteSessionDelete(clientStub, session.id);
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

function createProviderCatalog(
  providerId: string,
  models: Record<string, string>,
  defaultModelId: string
) {
  return {
    data: {
      providers: [
        {
          id: providerId,
          models: Object.fromEntries(
            Object.entries(models).map(([modelId, id]) => [modelId, { id }])
          ),
        },
      ],
      default: { [providerId]: defaultModelId },
    },
  };
}

function createCodexProviderCatalog(defaultModelId = TEMPLATE_MODEL_ID) {
  return createProviderCatalog(
    TEST_PROVIDER_ID,
    {
      [CODEX_MODEL_ID]: CODEX_MODEL_PATH,
      [TEMPLATE_MODEL_ID]: TEMPLATE_MODEL_ID,
    },
    defaultModelId
  );
}

function createTemplateProviderCatalog() {
  return createProviderCatalog(
    TEST_PROVIDER_ID,
    { [TEMPLATE_MODEL_ID]: TEMPLATE_MODEL_ID },
    TEMPLATE_MODEL_ID
  );
}

function createFallbackProviderCatalog() {
  return createProviderCatalog(
    TEST_PROVIDER_ID,
    { [FALLBACK_MODEL_ID]: FALLBACK_MODEL_ID },
    FALLBACK_MODEL_ID
  );
}

function createMultiProviderCatalog(
  providers: Array<{
    id: string;
    models: Record<string, string>;
  }>,
  defaults: Record<string, string>
) {
  return {
    data: {
      providers: providers.map((provider) => ({
        id: provider.id,
        models: Object.fromEntries(
          Object.entries(provider.models).map(([modelId, id]) => [
            modelId,
            { id },
          ])
        ),
      })),
      default: defaults,
    },
  };
}

function createHiveConfigWithTemplateAgent(
  agent: NonNullable<HiveConfig["templates"][string]["agent"]>,
  overrides: Partial<HiveConfig> = {}
): HiveConfig {
  const baseTemplate = mockHiveConfig.templates[TEMPLATE_ID];
  if (!baseTemplate) {
    throw new Error("Test template missing");
  }

  return {
    ...mockHiveConfig,
    ...overrides,
    templates: {
      ...mockHiveConfig.templates,
      [TEMPLATE_ID]: {
        ...baseTemplate,
        agent,
      },
    },
  };
}

function createHistoryMessage(input: {
  id: string;
  sessionId?: string;
  role: string;
  modelId?: string;
  providerId?: string;
  mode?: string;
  completed?: boolean;
}) {
  const now = Date.now();
  return {
    info: {
      id: input.id,
      sessionID: input.sessionId ?? RUNTIME_SESSION_ID,
      role: input.role,
      ...(input.mode ? { mode: input.mode } : {}),
      time: {
        created: now,
        updated: now,
        ...(input.completed ? { completed: now } : {}),
      },
      ...(input.modelId
        ? {
            model: {
              providerID: input.providerId ?? TEST_PROVIDER_ID,
              modelID: input.modelId,
            },
          }
        : {}),
    },
    parts: [],
  };
}

function createMessagesResponse(
  ...messages: ReturnType<typeof createHistoryMessage>[]
) {
  return { data: messages };
}

function createModel(providerID: string, modelID: string) {
  return { providerID, modelID };
}

function getLastPromptBody<TBody>(clientStub: ClientStub): TBody | undefined {
  const promptCall = clientStub.session.prompt.mock.calls.at(-1);
  if (!promptCall) {
    throw new Error("Expected prompt call to be recorded");
  }
  return (promptCall?.[0] as { body?: TBody })?.body;
}

function expectSessionModel(
  session: { provider?: string; modelId?: string },
  provider: string | undefined,
  modelId: string | undefined
) {
  if (session.provider !== provider || session.modelId !== modelId) {
    throw new Error(
      `Expected session model ${provider}/${modelId}, got ${session.provider}/${session.modelId}`
    );
  }
}

function expectSeedPrompt(
  clientStub: ClientStub,
  sessionId: string,
  body: Record<string, unknown>
) {
  // biome-ignore lint/suspicious/noMisplacedAssertion: shared test helper wraps repeated mock assertion.
  expect(clientStub.session.prompt).toHaveBeenCalledWith({
    path: { id: sessionId },
    query: { directory: TEST_WORKSPACE_PATH },
    body,
  });
}

function expectSeedPromptForModel(
  clientStub: ClientStub,
  sessionId: string,
  modelId: string
) {
  expectSeedPrompt(clientStub, sessionId, {
    noReply: true,
    model: createModel(TEST_PROVIDER_ID, modelId),
    parts: [],
  });
}

function expectRemoteSessionDelete(clientStub: ClientStub, sessionId: string) {
  // biome-ignore lint/suspicious/noMisplacedAssertion: shared test helper wraps repeated mock assertion.
  expect(clientStub.session.delete).toHaveBeenCalledWith({
    path: { id: sessionId },
    query: { directory: TEST_WORKSPACE_PATH },
  });
}

function expectContinuePrompt(clientStub: ClientStub, sessionId: string) {
  // biome-ignore lint/suspicious/noMisplacedAssertion: shared test helper wraps repeated mock assertion.
  expect(clientStub.session.prompt).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { id: sessionId },
      body: expect.objectContaining({
        parts: [{ type: "text", text: "Please continue" }],
      }),
    })
  );
}

async function expectInvalidOverrideError(result: Promise<unknown>) {
  // biome-ignore lint/suspicious/noMisplacedAssertion: shared test helper wraps repeated rejection assertion.
  await expect(result).rejects.toThrow(
    `Selected model override is invalid: model "${INVALID_MODEL_ID}" is unavailable for provider "${TEST_PROVIDER_ID}". Available models: ${FALLBACK_MODEL_ID}. Refresh the model catalog and try again.`
  );
}

function expectSeedWarning(warnSpy: Mock, sessionId: string, message: string) {
  // biome-ignore lint/suspicious/noMisplacedAssertion: shared test helper wraps repeated mock assertion.
  expect(warnSpy).toHaveBeenCalledWith(
    "[agent] Failed to seed session model preference",
    expect.objectContaining({
      cellId: TEST_CELL_ID,
      sessionId,
      providerId: TEST_PROVIDER_ID,
      modelId: "gpt-5.3-codex",
      message,
    })
  );
}

async function expectResumeOnStartup(cellId: string) {
  const [cell] = await testDb
    .select({
      resumeAgentSessionOnStartup: cells.resumeAgentSessionOnStartup,
    })
    .from(cells)
    .where(eq(cells.id, cellId));

  if (cell?.resumeAgentSessionOnStartup !== true) {
    throw new Error("Expected resumeAgentSessionOnStartup to be true");
  }
}

async function markResumeOnStartup(cellId: string) {
  await testDb
    .update(cells)
    .set({ resumeAgentSessionOnStartup: true })
    .where(eq(cells.id, cellId));
}

function mockUserMessageHistory(sessionId: string) {
  sessionMessagesMock.mockResolvedValue(
    createMessagesResponse(
      createHistoryMessage({
        id: "msg-user",
        sessionId,
        role: "user",
      })
    )
  );
}

async function preparePersistedResumeSession() {
  const session = await ensureAgentSession(TEST_CELL_ID, { startMode: "plan" });

  await closeAllAgentSessions({ deleteRemote: false });
  await markResumeOnStartup(TEST_CELL_ID);
  mockUserMessageHistory(session.id);

  return session;
}

function createQuestionRepliedEvent(): OpencodeEvent {
  return {
    type: "question.replied",
    properties: {
      id: "question_123",
      sessionID: RUNTIME_SESSION_ID,
      text: "Continue?",
      answer: "Yes",
    },
  } as unknown as OpencodeEvent;
}

function createMockSession() {
  const now = Date.now();
  return {
    id: RUNTIME_SESSION_ID,
    projectID: "project-1",
    directory: TEST_WORKSPACE_PATH,
    title: "Mock Session",
    version: "1",
    time: {
      created: now,
      updated: now,
    },
  };
}
