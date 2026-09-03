import type { OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client";
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
const EVENT_STREAM_RECONNECT_DELAY_MS = 1000;
const EXPECTED_RECONNECT_CLIENT_ACQUISITIONS = 3;

type ClientStub = {
  session: {
    active: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    interrupt: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    switchModel: ReturnType<typeof vi.fn>;
    inbox: { list: ReturnType<typeof vi.fn> };
  };
  event: {
    subscribe: ReturnType<typeof vi.fn>;
  };
  message: {
    list: ReturnType<typeof vi.fn>;
  };
  model: {
    default: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  form: { list: ReturnType<typeof vi.fn> };
  permission: {
    list: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
  };
  plugin: { list: ReturnType<typeof vi.fn> };
  provider: { list: ReturnType<typeof vi.fn> };
};

const ensureHiveOpencodePluginMock = vi.fn().mockResolvedValue(undefined);
const ensureHiveToolConfigMock = vi.fn().mockResolvedValue(undefined);

const sessionMessagesMock = vi
  .fn()
  .mockResolvedValue({ data: [] as unknown[], cursor: {} });

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
  fetchAgentMessages,
  fetchAgentSession,
  fetchAgentSessionForCell,
  fetchCompactionStats,
  interruptAgentSession,
  prepareAgentSessionsForShutdown,
  prepareSessionsForServiceReplacement,
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
    loadHiveConfigMock = vi.fn(async () => mockHiveConfig);
    loadEffectiveOpencodeDefaultsSpy = vi
      .spyOn(OpencodeConfig, "loadEffectiveOpencodeDefaults")
      .mockResolvedValue({});
    useClientStub(clientStub);

    await closeAllAgentSessions();
    await testDb.delete(cellProvisioningStates);
    await testDb.delete(cells);
    sessionMessagesMock.mockReset();
    ensureHiveOpencodePluginMock.mockClear();
    ensureHiveToolConfigMock.mockClear();
    sessionMessagesMock.mockResolvedValue({ data: [], cursor: {} });

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

  afterEach(async () => {
    await closeAllAgentSessions();
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
    mockProviderCatalog(clientStub, createCodexProviderCatalog());

    const session = await ensureCodexBuildSession();

    expectSessionModel(session, TEST_PROVIDER_ID, CODEX_MODEL_PATH);
    expectSeedWarning(warnSpy, session.id, message);
  }

  function useEventsClient(events: OpenCodeEvent[]) {
    const clientStubWithEvents = buildClientStubWithEvents(events);
    useClientStub(clientStubWithEvents);
  }

  function useClientStub(
    stub: ClientStub,
    published?: unknown[],
    onPublish?: (event: unknown) => void
  ) {
    acquireOpencodeClientMock = vi.fn(
      async () => stub as unknown as OpenCodeClient
    );

    setAgentRuntimeDependencies({
      db: testDb as unknown as AppDb,
      loadHiveConfig: loadHiveConfigMock,
      loadEffectiveOpencodeDefaults: loadEffectiveOpencodeDefaultsSpy,
      acquireOpencodeClient: acquireOpencodeClientMock,
      ensureHiveOpencodePlugin: ensureHiveOpencodePluginMock,
      ensureHiveToolConfig: ensureHiveToolConfigMock,
      ...(published
        ? {
            publishAgentEvent: (sessionId, event) => {
              if (sessionId === RUNTIME_SESSION_ID) {
                published.push(event);
                onPublish?.(event);
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

  it("hydrates runtime model from v2 model selection history", async () => {
    sessionMessagesMock.mockResolvedValueOnce({
      data: [
        createHistoryMessage({
          id: "msg-user",
          sessionId: "session-restored",
          role: "user",
          modelId: "restored-model",
        }),
      ],
      cursor: {},
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

    expect(clientStub.plugin.list).toHaveBeenCalledWith({
      location: { directory: TEST_WORKSPACE_PATH },
    });
    expect(clientStub.session.switchModel).toHaveBeenLastCalledWith({
      sessionID: session.id,
      model: createModel(TEST_PROVIDER_ID, "big-pickle"),
    });
    expect(clientStub.session.prompt).toHaveBeenLastCalledWith({
      sessionID: session.id,
      text: "Run task with new model",
    });
  });

  it("reconnects a runtime after its shared event stream closes", async () => {
    vi.useFakeTimers();
    try {
      const replacementClient = buildClientStub();
      acquireOpencodeClientMock
        .mockResolvedValueOnce(clientStub as unknown as OpenCodeClient)
        .mockResolvedValueOnce(clientStub as unknown as OpenCodeClient)
        .mockResolvedValue(replacementClient as unknown as OpenCodeClient);

      const session = await ensureAgentSession(cellId);
      await Promise.resolve();
      vi.advanceTimersByTime(EVENT_STREAM_RECONNECT_DELAY_MS);
      await Promise.resolve();
      await sendAgentMessage(session.id, "Continue after reconnect");

      expect(acquireOpencodeClientMock).toHaveBeenCalledTimes(
        EXPECTED_RECONNECT_CLIENT_ACQUISITIONS
      );
      expect(replacementClient.session.prompt).toHaveBeenCalledWith({
        sessionID: session.id,
        text: "Continue after reconnect",
      });
      await closeAllAgentSessions();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts the live event subscription before reconciling runtime state", async () => {
    let subscriptionStarted = false;
    clientStub.event.subscribe.mockImplementation(({ signal }) => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            subscriptionStarted = true;
            return new Promise<IteratorResult<OpenCodeEvent>>((resolve) => {
              signal?.addEventListener(
                "abort",
                () => resolve({ done: true, value: undefined }),
                { once: true }
              );
            });
          },
        };
      },
    }));
    clientStub.session.active.mockImplementation(() => {
      expect(subscriptionStarted).toBe(true);
      return Promise.resolve({});
    });

    await ensureAgentSession(cellId);
  });

  it("aborts the live subscription when initial reconciliation fails", async () => {
    let subscriptionSignal: AbortSignal | undefined;
    clientStub.event.subscribe.mockImplementation(({ signal }) => {
      subscriptionSignal = signal;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<OpenCodeEvent>>((resolve) => {
                signal?.addEventListener(
                  "abort",
                  () => resolve({ done: true, value: undefined }),
                  { once: true }
                );
              }),
          };
        },
      };
    });
    clientStub.session.active.mockRejectedValue(
      new Error("initial reconciliation failed")
    );

    await expect(ensureAgentSession(cellId)).rejects.toThrow(
      "initial reconciliation failed"
    );
    expect(subscriptionSignal?.aborted).toBe(true);
  });

  it("loads every page of remote messages in timeline order", async () => {
    const session = await ensureAgentSession(cellId);
    sessionMessagesMock.mockReset();
    sessionMessagesMock
      .mockResolvedValueOnce({
        data: [createHistoryMessage({ id: "msg-1", role: "user" })],
        cursor: { next: "page-2" },
      })
      .mockResolvedValueOnce({
        data: [createHistoryMessage({ id: "msg-2", role: "assistant" })],
        cursor: {},
      });

    const messages = await fetchAgentMessages(session.id);

    expect(messages.map((message) => message.id)).toEqual(["msg-1", "msg-2"]);
    expect(sessionMessagesMock).toHaveBeenNthCalledWith(1, {
      sessionID: session.id,
      limit: 200,
      order: "asc",
    });
    expect(sessionMessagesMock).toHaveBeenNthCalledWith(2, {
      sessionID: session.id,
      limit: 200,
      cursor: "page-2",
    });
  });

  it("rejects repeated message cursors instead of looping", async () => {
    const session = await ensureAgentSession(cellId);
    sessionMessagesMock.mockReset();
    sessionMessagesMock.mockResolvedValue({
      data: [createHistoryMessage({ id: "msg-1", role: "user" })],
      cursor: { next: "same-page" },
    });

    await expect(fetchAgentMessages(session.id)).rejects.toThrow(
      'OpenCode message pagination repeated cursor "same-page"'
    );
    expect(sessionMessagesMock).toHaveBeenCalledTimes(2);
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

    expect(clientStub.session.switchModel).toHaveBeenLastCalledWith({
      sessionID: session.id,
      model: {
        ...createModel(TEST_PROVIDER_ID, "big-pickle"),
        variant: "high",
      },
    });
    expect(clientStub.session.prompt).toHaveBeenLastCalledWith({
      sessionID: session.id,
      text: "Run task with variant",
    });
  });

  it("prefers the template's agent configuration over opencode defaults", async () => {
    loadEffectiveOpencodeDefaultsSpy.mockResolvedValue({
      defaultModel: { providerId: "openai", modelId: "gpt-5.1-codex-high" },
    });

    mockProviderCatalog(
      clientStub,
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

    mockProviderCatalog(
      clientStub,
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

    mockProviderCatalog(
      clientStub,
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

    expect(clientStub.session.switchModel).not.toHaveBeenCalled();
    expect(clientStub.session.prompt).toHaveBeenLastCalledWith({
      sessionID: session.id,
      text: "Reply with ok",
    });
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

    expect(clientStub.session.prompt).toHaveBeenLastCalledWith({
      sessionID: session.id,
      text: "Inspect the screenshot",
      files: [
        {
          uri: "data:image/png;base64,aGVsbG8=",
          name: "cell.png",
        },
      ],
    });
  });

  it("falls back to hive defaults when workspace defaults target another provider", async () => {
    mockTemplateAgentDefaults("openai", "gpt-5.1-codex-high");

    const session = await ensureAgentSession(cellId);

    expectSessionModel(session, TEST_PROVIDER_ID, TEMPLATE_MODEL_ID);
  });

  it("accepts explicit model override when it matches provider model id", async () => {
    mockProviderCatalog(clientStub, createCodexProviderCatalog());

    const session = await ensureCodexBuildSession();

    expectSessionModel(session, TEST_PROVIDER_ID, CODEX_MODEL_PATH);
    expectSelectedModel(clientStub, session.id, CODEX_MODEL_PATH);
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

    mockProviderCatalog(
      clientStub,
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

    expectSessionModel(session, TEST_PROVIDER_ID, "opencode/glm-5");
    expect(clientStub.session.create).toHaveBeenCalledWith({
      title: "Model Test Cell",
      agent: "plan",
      location: { directory: TEST_WORKSPACE_PATH },
    });
    expect(clientStub.session.switchModel).toHaveBeenCalledWith({
      sessionID: session.id,
      model: createModel(TEST_PROVIDER_ID, "opencode/glm-5"),
    });
  });

  it("keeps runtime startup available when model selection rejects", async () => {
    await expectRuntimeStartupAfterSeedFailure("seed unavailable", () => {
      clientStub.session.switchModel.mockRejectedValueOnce(
        new Error("seed unavailable")
      );
    });
  });

  it("keeps runtime startup available when model seeding throws", async () => {
    await expectRuntimeStartupAfterSeedFailure("socket closed", () => {
      clientStub.session.switchModel.mockRejectedValueOnce(
        new Error("socket closed")
      );
    });
  });

  it("skips stale provisioning overrides for restorable sessions", async () => {
    await persistRuntimeSession(cellId);

    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: "opencode/stale-model",
      providerIdOverride: TEST_PROVIDER_ID,
    });

    sessionMessagesMock.mockRejectedValueOnce(
      new Error("messages unavailable")
    );

    mockProviderCatalog(clientStub, createTemplateProviderCatalog());

    const session = await ensureAgentSession(cellId);

    expectSessionModel(session, TEST_PROVIDER_ID, TEMPLATE_MODEL_ID);
    expect(clientStub.session.create).not.toHaveBeenCalled();
    expect(clientStub.session.switchModel).not.toHaveBeenCalled();
  });

  it("preserves persisted session IDs when session lookup fails transiently", async () => {
    await persistRuntimeSession(cellId);
    clientStub.session.get.mockRejectedValue(new Error("connection reset"));

    await expect(ensureAgentSession(cellId)).rejects.toThrow(
      "connection reset"
    );

    expect(clientStub.session.create).not.toHaveBeenCalled();
    await expectPersistedSessionId(cellId);
  });

  it("does not replace sessions for unrelated HTTP not-found failures", async () => {
    await persistRuntimeSession(cellId);
    clientStub.session.get.mockRejectedValue({
      status: 404,
      message: "workspace not found",
    });

    await expect(ensureAgentSession(cellId)).rejects.toMatchObject({
      status: 404,
      message: "workspace not found",
    });

    expect(clientStub.session.create).not.toHaveBeenCalled();
    await expectPersistedSessionId(cellId);
  });

  it("refreshes the Hive plugin and server URL before restoring a cell runtime", async () => {
    const originalHiveUrl = process.env.HIVE_URL;
    process.env.HIVE_URL = "http://127.0.0.1:4100";
    try {
      await persistRuntimeSession(cellId);

      await ensureAgentSession(cellId);

      expect(ensureHiveOpencodePluginMock).toHaveBeenCalledWith(
        TEST_WORKSPACE_PATH
      );
      expect(ensureHiveToolConfigMock).toHaveBeenCalledWith(
        TEST_WORKSPACE_PATH,
        {
          cellId,
          hiveUrl: "http://127.0.0.1:4100",
        }
      );
    } finally {
      if (originalHiveUrl === undefined) {
        process.env.HIVE_URL = undefined;
      } else {
        process.env.HIVE_URL = originalHiveUrl;
      }
    }
  });

  it("reuses persisted provisioning model overrides before first message", async () => {
    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: CODEX_MODEL_PATH,
      providerIdOverride: TEST_PROVIDER_ID,
    });

    mockProviderCatalog(clientStub, createCodexProviderCatalog());

    const session = await ensureAgentSession(cellId);

    expectSessionModel(session, TEST_PROVIDER_ID, CODEX_MODEL_PATH);
    expectSelectedModel(clientStub, session.id, CODEX_MODEL_PATH);
  });

  it("throws clear errors for invalid persisted model overrides", async () => {
    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: INVALID_MODEL_ID,
      providerIdOverride: TEST_PROVIDER_ID,
    });

    mockProviderCatalog(clientStub, createFallbackProviderCatalog());

    await expectInvalidOverrideError(ensureAgentSession(cellId));
  });

  it("throws clear errors for invalid explicit model overrides", async () => {
    mockTemplateAgentDefaults(TEST_PROVIDER_ID, INVALID_MODEL_ID);

    mockProviderCatalog(clientStub, createFallbackProviderCatalog());

    await expectInvalidOverrideError(
      ensureAgentSession(cellId, {
        modelId: INVALID_MODEL_ID,
        providerId: TEST_PROVIDER_ID,
      })
    );
  });

  it("tracks compaction events and exposes stats", async () => {
    const compactionEvent: OpenCodeEvent = {
      id: "evt-compaction",
      created: Date.now(),
      type: "session.compaction.ended",
      durable: createDurableEvent(),
      data: {
        sessionID: RUNTIME_SESSION_ID,
        reason: "auto",
        text: "summary",
        recent: "recent",
      },
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
    const modeEvent: OpenCodeEvent = {
      id: "evt-mode",
      created: Date.now(),
      type: "session.step.started",
      durable: createDurableEvent(),
      data: {
        sessionID: RUNTIME_SESSION_ID,
        assistantMessageID: "msg-mode",
        agent: "build",
        model: { id: "big-pickle", providerID: TEST_PROVIDER_ID },
      },
    };

    const published: unknown[] = [];
    const clientStubWithEvents = buildClientStub();
    let releaseBuildEvent: (() => void) | undefined;
    const emitBuildEvent = new Promise<void>((resolve) => {
      releaseBuildEvent = resolve;
    });
    clientStubWithEvents.event.subscribe = vi.fn(() =>
      (async function* () {
        await emitBuildEvent;
        yield modeEvent;
      })()
    );

    useClientStub(clientStubWithEvents, published);

    const initial = await ensureAgentSession(cellId, { startMode: "plan" });
    expect(initial.startMode).toBe("plan");
    expect(initial.currentMode).toBe("plan");

    releaseBuildEvent?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const updated = await ensureAgentSession(cellId);
    expect(updated.startMode).toBe("plan");
    expect(updated.currentMode).toBe("build");
    expect(updated.modelId).toBe("big-pickle");
    expect(updated.modelProviderId).toBe(TEST_PROVIDER_ID);
    expect(
      published.some(
        (event) =>
          (event as { type?: string; currentMode?: string }).type === "mode" &&
          (event as { currentMode?: string }).currentMode === "build"
      )
    ).toBe(true);
  });

  it("resyncs mode from v2 session metadata on cell session fetch", async () => {
    await ensureAgentSession(cellId, { startMode: "plan" });
    await closeAllAgentSessions({ deleteRemote: false });
    clientStub.session.get.mockResolvedValue({
      ...createMockSession(),
      agent: "build",
      model: {
        providerID: "openai",
        id: "gpt-5.4",
        variant: "high",
      },
    });

    const session = await fetchAgentSessionForCell(cellId);

    expect(session).not.toBeNull();
    expect(session?.currentMode).toBe("build");
    expect(session?.modelProviderId).toBe("openai");
    expect(session?.modelId).toBe("gpt-5.4");
    expect(session?.modelVariant).toBe("high");
    expect(clientStub.session.get).toHaveBeenCalledWith({
      sessionID: RUNTIME_SESSION_ID,
    });
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

  it("does not enqueue duplicate resume work for an active session", async () => {
    const session = await preparePersistedResumeSession();
    clientStub.session.active.mockResolvedValue({
      [session.id]: { type: "running" },
    });
    clientStub.session.prompt.mockClear();

    await resumeAgentSessionsOnStartup();

    expect(clientStub.session.prompt).not.toHaveBeenCalled();
    await expectResumeOnStartup(cellId);
  });

  it("recovers pending permission input without enqueueing resume work", async () => {
    await persistRuntimeSession(cellId);
    const published: unknown[] = [];
    useClientStub(clientStub, published);
    clientStub.permission.list.mockResolvedValue([
      {
        id: "permission-1",
        sessionID: RUNTIME_SESSION_ID,
        action: "shell",
        resources: ["bun test"],
      },
    ]);

    await resumeAgentSessionsOnStartup();

    expect(clientStub.session.prompt).not.toHaveBeenCalled();
    expect(
      published.some(
        (event) => (event as { type?: string }).type === "permission.asked"
      )
    ).toBe(true);
    await expectResumeOnStartup(cellId, false);
  });

  it("keeps persisted resume state when shutting down without deleting the remote session", async () => {
    await startPlanAfterQuestionAnswer(cellId);

    await closeAllAgentSessions({ deleteRemote: false });

    await expectResumeOnStartup(cellId);
  });

  it("interrupts active work for shutdown without clearing its resume marker", async () => {
    let releaseInterruptEvent: (() => void) | undefined;
    const emitInterruptEvent = new Promise<void>((resolve) => {
      releaseInterruptEvent = resolve;
    });
    clientStub.event.subscribe = vi.fn(() =>
      (async function* () {
        await emitInterruptEvent;
        yield createInterruptedEvent();
      })()
    );
    const published: unknown[] = [];
    let interruptionRequested = false;
    let resolveInterruptedStatus: (() => void) | undefined;
    const interruptedStatusPublished = new Promise<void>((resolve) => {
      resolveInterruptedStatus = resolve;
    });
    useClientStub(clientStub, published, (event) => {
      const status = event as { type?: string; status?: string };
      if (
        interruptionRequested &&
        status.type === "status" &&
        status.status === "awaiting_input"
      ) {
        resolveInterruptedStatus?.();
      }
    });
    clientStub.session.interrupt.mockImplementation(() => {
      interruptionRequested = true;
      releaseInterruptEvent?.();
      return Promise.resolve({ interrupted: true });
    });
    const session = await ensureAgentSession(cellId);
    await sendAgentMessage(session.id, "Long-running work");
    clientStub.session.active.mockResolvedValue({
      [session.id]: { type: "running" },
    });
    published.length = 0;

    await prepareAgentSessionsForShutdown();

    await interruptedStatusPublished;
    expect(published).toContainEqual({
      type: "status",
      status: "awaiting_input",
    });
    expect(clientStub.session.interrupt).toHaveBeenCalledWith({
      sessionID: session.id,
    });
    await expectResumeOnStartup(cellId);
  });

  it("interrupts with the v2 contract and allows the next prompt to resume work", async () => {
    const session = await ensureAgentSession(cellId);

    await interruptAgentSession(session.id);

    expect(clientStub.session.interrupt).toHaveBeenCalledWith({
      sessionID: session.id,
    });
    await expectResumeOnStartup(cellId, false);

    await sendAgentMessage(session.id, "Continue after interrupt");

    expect(clientStub.session.prompt).toHaveBeenLastCalledWith({
      sessionID: session.id,
      text: "Continue after interrupt",
    });
    await expectResumeOnStartup(cellId);
  });

  it("clears pending interrupt state when the v2 interrupt rejects", async () => {
    const session = await ensureAgentSession(cellId);
    clientStub.session.interrupt.mockRejectedValueOnce(
      new Error("interrupt unavailable")
    );

    await expect(interruptAgentSession(session.id)).rejects.toThrow(
      "interrupt unavailable"
    );
    await sendAgentMessage(session.id, "Continue after interrupt failure");

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

    expect(clientStub.session.remove).not.toHaveBeenCalled();
  });

  it("ignores missing session errors during runtime shutdown", async () => {
    clientStub.session.remove.mockRejectedValue({
      _tag: "SessionNotFoundError",
    });

    await ensureAgentSession(cellId);

    await expect(
      closeAllAgentSessions({ deleteRemote: true })
    ).resolves.toBeUndefined();
    expect(clientStub.session.remove).toHaveBeenCalled();
  });

  it("deletes persisted sessions after shutdown when runtime map is empty", async () => {
    const session = await ensureAgentSession(cellId);

    await closeAllAgentSessions({ deleteRemote: false });
    clientStub.session.remove.mockClear();

    await closeAgentSession(cellId);

    expectRemoteSessionDelete(clientStub, session.id);
  });

  it.each([
    {
      label: "shutdown",
      prepare: () => prepareAgentSessionsForShutdown(),
    },
    {
      label: "service replacement",
      prepare: () =>
        prepareSessionsForServiceReplacement(
          clientStub as unknown as OpenCodeClient
        ),
    },
  ])(
    "marks and interrupts persisted Hive-owned active sessions for $label",
    async ({ prepare }) => {
      await persistRuntimeSession(cellId);
      clientStub.session.active.mockResolvedValue({
        [RUNTIME_SESSION_ID]: { type: "running" },
        "session-external": { type: "running" },
      });

      await prepare();

      await expectResumeOnStartup(cellId);
      expect(clientStub.session.interrupt).toHaveBeenCalledTimes(1);
      expect(clientStub.session.interrupt).toHaveBeenCalledWith({
        sessionID: RUNTIME_SESSION_ID,
      });
    }
  );
});

function buildClientStub(): ClientStub {
  const session = {
    active: vi.fn(async () => ({})),
    create: vi.fn(async () => createMockSession()),
    get: vi.fn(async () => createMockSession()),
    interrupt: vi.fn(async () => ({ interrupted: true })),
    prompt: vi.fn(async () => createPromptResult()),
    remove: vi.fn(() => Promise.resolve()),
    switchModel: vi.fn(() => Promise.resolve()),
    inbox: { list: vi.fn(async () => []) },
  };

  return {
    session,
    event: {
      subscribe: vi.fn(() =>
        (async function* () {
          // noop stream
        })()
      ),
    },
    message: { list: sessionMessagesMock },
    model: {
      default: vi.fn(async () => ({
        location: createV2Location(),
        data: null,
      })),
      list: vi.fn(async () => ({
        location: createV2Location(),
        data: [],
      })),
    },
    form: { list: vi.fn(async () => []) },
    permission: createPermissionStub(),
    plugin: {
      list: vi.fn(async () => ({
        location: createV2Location(),
        data: [
          {
            id: "hive.cell.v2.r1.tools-context-shell-permission",
            source: {
              type: "local",
              path: "/tmp/model-test/.opencode/plugins/hive/index.js",
            },
            features: {},
            state: { status: "active" },
          },
        ],
      })),
    },
    provider: {
      list: vi.fn(async () => ({
        location: createV2Location(),
        data: [],
      })),
    },
  };
}

function buildClientStubWithEvents(events: OpenCodeEvent[]): ClientStub {
  const stub = buildClientStub();
  stub.event.subscribe = vi.fn(() =>
    (function* () {
      for (const event of events) {
        yield event;
      }
    })()
  );
  return stub;
}

type TestProviderCatalog = {
  providers: Array<{
    id: string;
    models: Record<string, { id: string }>;
  }>;
  default: Record<string, string>;
};

function createProviderCatalog(
  providerId: string,
  models: Record<string, string>,
  defaultModelId: string
) {
  return {
    providers: [
      {
        id: providerId,
        models: Object.fromEntries(
          Object.entries(models).map(([modelId, id]) => [modelId, { id }])
        ),
      },
    ],
    default: { [providerId]: defaultModelId },
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
  };
}

function mockProviderCatalog(
  client: ClientStub,
  catalog: TestProviderCatalog
): void {
  const models = catalog.providers.flatMap((provider) =>
    Object.entries(provider.models).map(([modelID, model]) =>
      createV2Model(provider.id, modelID, model.id)
    )
  );
  const [defaultProvider] = Object.keys(catalog.default);
  const defaultModelID = defaultProvider
    ? catalog.default[defaultProvider]
    : undefined;
  const defaultModel = models.find(
    (model) =>
      model.providerID === defaultProvider && model.modelID === defaultModelID
  );

  client.provider.list.mockResolvedValue({
    location: createV2Location(),
    data: catalog.providers.map((provider) => ({
      id: provider.id,
      name: provider.id,
      activation: "enabled",
      package: `@ai-sdk/${provider.id}`,
    })),
  });
  client.model.list.mockResolvedValue({
    location: createV2Location(),
    data: models,
  });
  client.model.default.mockResolvedValue({
    location: createV2Location(),
    data: defaultModel ?? null,
  });
}

function createV2Model(providerID: string, modelID: string, id: string) {
  return {
    id,
    modelID,
    providerID,
    name: modelID,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 128_000, output: 16_000 },
  };
}

function createV2Location() {
  return {
    directory: TEST_WORKSPACE_PATH,
    project: {
      id: "project-1",
      directory: TEST_WORKSPACE_PATH,
      canonical: TEST_WORKSPACE_PATH,
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
  if (input.modelId) {
    return {
      id: input.id,
      type: "model-switched" as const,
      time: { created: now },
      model: {
        providerID: input.providerId ?? TEST_PROVIDER_ID,
        id: input.modelId,
      },
    };
  }
  if (input.role === "assistant") {
    return {
      id: input.id,
      type: "assistant" as const,
      agent: input.mode ?? "plan",
      model: { providerID: TEST_PROVIDER_ID, id: TEMPLATE_MODEL_ID },
      time: {
        created: now,
        ...(input.completed ? { completed: now } : {}),
      },
      content: [],
    };
  }
  if (input.mode) {
    return {
      id: input.id,
      type: "agent-switched" as const,
      time: { created: now },
      agent: input.mode,
    };
  }
  return {
    id: input.id,
    type: "user" as const,
    time: { created: now },
    text: "Continue",
  };
}

function createMessagesResponse(
  ...messages: ReturnType<typeof createHistoryMessage>[]
) {
  return { data: messages, cursor: {} };
}

function createModel(providerID: string, id: string) {
  return { providerID, id };
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

function expectSelectedModel(
  clientStub: ClientStub,
  sessionId: string,
  modelId: string
) {
  // biome-ignore lint/suspicious/noMisplacedAssertion: shared test helper wraps repeated mock assertion.
  expect(clientStub.session.switchModel).toHaveBeenCalledWith({
    sessionID: sessionId,
    model: createModel(TEST_PROVIDER_ID, modelId),
  });
}

function expectRemoteSessionDelete(clientStub: ClientStub, sessionId: string) {
  // biome-ignore lint/suspicious/noMisplacedAssertion: shared test helper wraps repeated mock assertion.
  expect(clientStub.session.remove).toHaveBeenCalledWith({
    sessionID: sessionId,
  });
}

function expectContinuePrompt(clientStub: ClientStub, sessionId: string) {
  // biome-ignore lint/suspicious/noMisplacedAssertion: shared test helper wraps repeated mock assertion.
  expect(clientStub.session.prompt).toHaveBeenCalledWith({
    sessionID: sessionId,
    text: "",
    resume: true,
  });
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
      modelId: CODEX_MODEL_PATH,
      message,
    })
  );
}

async function expectResumeOnStartup(cellId: string, expected = true) {
  const [cell] = await testDb
    .select({
      resumeAgentSessionOnStartup: cells.resumeAgentSessionOnStartup,
    })
    .from(cells)
    .where(eq(cells.id, cellId));

  if (cell?.resumeAgentSessionOnStartup !== expected) {
    throw new Error(`Expected resumeAgentSessionOnStartup to be ${expected}`);
  }
}

async function expectPersistedSessionId(cellId: string) {
  const [cell] = await testDb
    .select({ sessionId: cells.opencodeSessionId })
    .from(cells)
    .where(eq(cells.id, cellId));
  // biome-ignore lint/suspicious/noMisplacedAssertion: shared test helper verifies persisted state.
  expect(cell?.sessionId).toBe(RUNTIME_SESSION_ID);
}

async function markResumeOnStartup(cellId: string) {
  await testDb
    .update(cells)
    .set({ resumeAgentSessionOnStartup: true })
    .where(eq(cells.id, cellId));
}

async function persistRuntimeSession(cellId: string) {
  await testDb
    .update(cells)
    .set({ opencodeSessionId: RUNTIME_SESSION_ID })
    .where(eq(cells.id, cellId));
}

function createPermissionStub() {
  return {
    list: vi.fn(async () => []),
    reply: vi.fn(() => Promise.resolve()),
  };
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

function createQuestionRepliedEvent(): OpenCodeEvent {
  return {
    id: "evt-question-replied",
    created: Date.now(),
    type: "form.replied",
    data: {
      id: "question_123",
      sessionID: RUNTIME_SESSION_ID,
      answer: { continue: true },
    },
  };
}

function createInterruptedEvent(): OpenCodeEvent {
  return {
    id: "evt-execution-interrupted",
    created: Date.now(),
    type: "session.execution.interrupted",
    durable: createDurableEvent(),
    data: { sessionID: RUNTIME_SESSION_ID, reason: "shutdown" },
  };
}

function createMockSession() {
  const now = Date.now();
  return {
    id: RUNTIME_SESSION_ID,
    projectID: "project-1",
    title: "Mock Session",
    location: { directory: TEST_WORKSPACE_PATH },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: {
      created: now,
      updated: now,
    },
  };
}

function createPromptResult() {
  return {
    id: "inbox-test",
    sessionID: RUNTIME_SESSION_ID,
    timeCreated: Date.now(),
    type: "user" as const,
    payload: { text: "" },
    delivery: "queue" as const,
  };
}

function createDurableEvent() {
  return { aggregateID: RUNTIME_SESSION_ID, seq: 1, version: 1 as const };
}
