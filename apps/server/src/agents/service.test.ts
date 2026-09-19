import type { V2Event } from "@opencode-ai/client";
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
import {
  applyV2ProviderCatalogFixture,
  createOpenCodeV2ClientFixture,
  createV2EventFixtures,
  createV2ProviderCatalogFixture,
  createV2SessionFixture,
  type OpenCodeV2ClientFixture,
  type V2ProviderCatalogFixture,
} from "../__tests__/opencode-v2-test-fixtures";
import { setupTestDb, testDb } from "../__tests__/test-db";
import type { HiveConfig } from "../config/schema";
import { cellProvisioningStates } from "../schema/cell-provisioning";
import { cells } from "../schema/cells";
// biome-ignore lint/performance/noNamespaceImport: tests need namespace import for spies
import * as OpencodeConfig from "./opencode-config";
import type { AgentStreamEvent } from "./types";

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
const PROVIDER_CATALOG_READY_TIMEOUT_MS = 15_000;
const EXPECTED_RECONNECT_CLIENT_ACQUISITIONS = 3;
const EXPECTED_PARTIAL_CATALOG_CALLS = 3;

type ClientStub = OpenCodeV2ClientFixture;

const ensureHiveOpencodePluginMock = vi.fn().mockResolvedValue(undefined);
const ensureHiveToolConfigMock = vi.fn().mockResolvedValue(undefined);

const v2Events = createV2EventFixtures(RUNTIME_SESSION_ID);

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
    ensureHiveOpencodePluginMock.mockClear();
    ensureHiveToolConfigMock.mockClear();

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

  function useEventsClient(events: V2Event[]) {
    const clientStubWithEvents = buildClientStubWithEvents(events);
    useClientStub(clientStubWithEvents);
  }

  function useClientStub(
    stub: ClientStub,
    published?: unknown[],
    onPublish?: (event: AgentStreamEvent) => void
  ) {
    acquireOpencodeClientMock = vi.fn(async () => stub.client);

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

  async function selectBigPickleModel(sessionId: string, variant?: string) {
    await updateAgentSessionModel(sessionId, {
      modelId: "big-pickle",
      providerId: TEST_PROVIDER_ID,
      ...(variant ? { variant } : {}),
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

  function configureEffectiveModel(
    providerId: string,
    modelId: string,
    includeDefaultModel = true
  ) {
    loadEffectiveOpencodeDefaultsSpy.mockResolvedValue({
      ...(includeDefaultModel ? { defaultModel: { providerId, modelId } } : {}),
      configuredProviderIds: [providerId],
    });
  }

  function createConfiguredCatalog(providerId: string, modelId: string) {
    return createProviderCatalog(providerId, { [modelId]: modelId }, modelId);
  }

  function mockCreatedSessionModel(providerId: string, modelId: string) {
    clientStub.session.create.mockResolvedValueOnce({
      ...createMockSession(),
      model: createModel(providerId, modelId),
    });
  }

  async function ensureConfiguredModelAfterCatalogs(
    providerId: string,
    modelId: string,
    ...catalogs: [V2ProviderCatalogFixture, ...V2ProviderCatalogFixture[]]
  ) {
    configureEffectiveModel(providerId, modelId);
    mockProviderCatalogSequence(clientStub, ...catalogs);
    mockCreatedSessionModel(providerId, modelId);
    return await ensureAgentSession(cellId);
  }

  function createConfiguredCatalogFixtures() {
    const providerId = "fixture-provider";
    const modelId = "fixture-model";
    return {
      configuredCatalog: createConfiguredCatalog(providerId, modelId),
      initialCatalog: createFallbackProviderCatalog(),
      modelId,
      providerId,
    };
  }

  async function startPlanAfterQuestionAnswer(targetCellId: string) {
    useEventsClient([v2Events.formReplied()]);
    await ensureAgentSession(targetCellId, { startMode: "plan" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("hydrates runtime model from v2 session metadata", async () => {
    await persistRuntimeSession(cellId);
    clientStub.session.get.mockResolvedValue({
      ...createMockSession(),
      model: createModel(TEST_PROVIDER_ID, "restored-model"),
    });

    const session = await ensureAgentSession(cellId);

    expect(session.modelId).toBe("restored-model");
    expect(session.modelProviderId).toBe(TEST_PROVIDER_ID);
    expect(clientStub.spies.listSessionMessages).not.toHaveBeenCalled();
  });

  it("sends prompts using the updated provider/model selection", async () => {
    const session = await ensureAgentSession(cellId);

    await selectBigPickleModel(session.id);

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

  it("waits for the generated Hive plugin before sending a prompt", async () => {
    clientStub.spies.listPlugins.mockResolvedValueOnce({
      location: clientStub.location,
      data: [],
    });

    const session = await ensureAgentSession(cellId);

    expect(clientStub.plugin.list).toHaveBeenCalledTimes(2);
    await sendAgentMessage(session.id, "Wait for plugin reload");
    expect(clientStub.session.prompt).toHaveBeenCalledWith({
      sessionID: session.id,
      text: "Wait for plugin reload",
    });
  });

  it("persists plugin load failures on the agent session", async () => {
    clientStub.session.create.mockResolvedValueOnce({
      ...createMockSession(),
      outcome: "succeeded",
    });
    const session = await ensureAgentSession(cellId);
    clientStub.spies.listPlugins.mockResolvedValue({
      location: clientStub.location,
      data: [
        {
          id: "hive.cell.v2.r1.tools-context-shell-permission",
          source: {
            type: "local",
            path: `${TEST_WORKSPACE_PATH}/.opencode/plugins/hive/index.js`,
          },
          features: {},
          state: { status: "failed", error: "plugin failed to load" },
        },
      ],
    });
    await expect(
      sendAgentMessage(session.id, "Do not send this prompt")
    ).rejects.toThrow("plugin failed to load");

    const failed = await fetchAgentSession(session.id);
    expect(failed).toMatchObject({
      status: "error",
      errorMessage: expect.stringContaining("plugin failed to load"),
    });
    expect(clientStub.session.prompt).not.toHaveBeenCalled();
  });

  it("reconnects a runtime after its shared event stream closes", async () => {
    vi.useFakeTimers();
    try {
      const replacementClient = buildClientStub();
      acquireOpencodeClientMock
        .mockResolvedValueOnce(clientStub.client)
        .mockResolvedValueOnce(clientStub.client)
        .mockResolvedValue(replacementClient.client);

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
    clientStub.event.subscribe.mockImplementation((options) =>
      createAbortableEventStream(options?.signal, () => {
        subscriptionStarted = true;
      })
    );
    clientStub.session.active.mockImplementation(() => {
      expect(subscriptionStarted).toBe(true);
      return Promise.resolve({});
    });

    await ensureAgentSession(cellId);
  });

  it("aborts the live subscription when initial reconciliation fails", async () => {
    let subscriptionSignal: AbortSignal | undefined;
    clientStub.event.subscribe.mockImplementation((options) => {
      const signal = options?.signal;
      subscriptionSignal = signal;
      return createAbortableEventStream(signal);
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
    clientStub.spies.listSessionMessages.mockReset();
    clientStub.spies.listSessionMessages
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
    expect(clientStub.spies.listSessionMessages).toHaveBeenNthCalledWith(1, {
      sessionID: session.id,
      limit: 200,
      order: "asc",
    });
    expect(clientStub.spies.listSessionMessages).toHaveBeenNthCalledWith(2, {
      sessionID: session.id,
      limit: 200,
      cursor: "page-2",
    });
  });

  it("rejects repeated message cursors instead of looping", async () => {
    const session = await ensureAgentSession(cellId);
    clientStub.spies.listSessionMessages.mockReset();
    clientStub.spies.listSessionMessages.mockResolvedValue({
      data: [createHistoryMessage({ id: "msg-1", role: "user" })],
      cursor: { next: "same-page" },
    });

    await expect(fetchAgentMessages(session.id)).rejects.toThrow(
      'OpenCode message pagination repeated cursor "same-page"'
    );
    expect(clientStub.spies.listSessionMessages).toHaveBeenCalledTimes(2);
  });

  it("serializes native v2 assistant messages and structured errors", async () => {
    const session = await ensureAgentSession(cellId);
    const created = Date.now();
    clientStub.spies.listSessionMessages.mockResolvedValue({
      data: [
        {
          id: "msg-aborted",
          type: "assistant",
          agent: "plan",
          model: createModel(TEST_PROVIDER_ID, TEMPLATE_MODEL_ID),
          time: { created },
          content: [{ type: "text", text: "Partial response" }],
          error: {
            type: "MessageAbortedError",
            message: "Request interrupted",
          },
        },
      ],
      cursor: {},
    });

    await expect(fetchAgentMessages(session.id)).resolves.toEqual([
      expect.objectContaining({
        id: "msg-aborted",
        sessionId: session.id,
        role: "assistant",
        content: "Partial response",
        state: "error",
        parentId: null,
        errorName: "MessageAbortedError",
        errorMessage: "Request interrupted",
      }),
    ]);
  });

  it("passes variants through when sending prompts", async () => {
    const session = await ensureAgentSession(cellId);

    await selectBigPickleModel(session.id, "high");

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
    expect(clientStub.session.create).toHaveBeenCalledWith({
      title: "Model Test Cell",
      agent: "plan",
      model: createModel(TEST_PROVIDER_ID, TEMPLATE_MODEL_ID),
      location: { directory: TEST_WORKSPACE_PATH },
    });
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

  it("waits for the configured default model to enter the provider catalog", async () => {
    const { configuredCatalog, initialCatalog, modelId, providerId } =
      createConfiguredCatalogFixtures();
    const session = await ensureConfiguredModelAfterCatalogs(
      providerId,
      modelId,
      initialCatalog,
      configuredCatalog
    );

    expectSessionModel(session, providerId, modelId);
    expect(clientStub.spies.listProviders).toHaveBeenCalledTimes(2);
  });

  it("waits until both the configured model and provider enter the catalog", async () => {
    const { configuredCatalog, initialCatalog, modelId, providerId } =
      createConfiguredCatalogFixtures();
    const modelOnlyCatalog = {
      ...configuredCatalog,
      default: initialCatalog.default,
      providers: initialCatalog.providers,
    };
    const session = await ensureConfiguredModelAfterCatalogs(
      providerId,
      modelId,
      initialCatalog,
      modelOnlyCatalog,
      configuredCatalog
    );

    expectSessionModel(session, providerId, modelId);
    expect(clientStub.spies.listProviders).toHaveBeenCalledTimes(
      EXPECTED_PARTIAL_CATALOG_CALLS
    );
  });

  it("waits for a persisted configured model override to enter the catalog", async () => {
    const configuredProviderId = "persisted-provider";
    const configuredModelId = "persisted-model";
    const initialCatalog = createFallbackProviderCatalog();
    const configuredCatalog = createConfiguredCatalog(
      configuredProviderId,
      configuredModelId
    );
    configureEffectiveModel(configuredProviderId, configuredModelId, false);
    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: configuredModelId,
      providerIdOverride: configuredProviderId,
    });
    mockProviderCatalogSequence(clientStub, initialCatalog, configuredCatalog);

    const session = await ensureAgentSession(cellId);

    expectSessionModel(session, configuredProviderId, configuredModelId);
    expect(clientStub.session.create).toHaveBeenCalledWith({
      title: "Model Test Cell",
      agent: "plan",
      model: createModel(configuredProviderId, configuredModelId),
      location: { directory: TEST_WORKSPACE_PATH },
    });
  });

  it("does not wait for lower-priority configured defaults when an explicit model is valid", async () => {
    configureEffectiveModel("unavailable-provider", "unavailable-model");
    mockProviderCatalog(clientStub, createCodexProviderCatalog());

    const session = await ensureCodexBuildSession();

    expectSessionModel(session, TEST_PROVIDER_ID, CODEX_MODEL_PATH);
    expect(clientStub.spies.listProviders).toHaveBeenCalledOnce();
  });

  it("fails after the configured model catalog readiness timeout", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(PROVIDER_CATALOG_READY_TIMEOUT_MS);
    configureEffectiveModel("unavailable-provider", "unavailable-model");
    mockProviderCatalog(clientStub, createFallbackProviderCatalog());

    await expect(ensureAgentSession(cellId)).rejects.toThrow(
      'Configured OpenCode model "unavailable-provider/unavailable-model" did not enter the provider catalog after 15000ms'
    );
    expect(clientStub.spies.listProviders).toHaveBeenCalledTimes(2);
    expect(clientStub.session.create).not.toHaveBeenCalled();
  });

  it("accepts explicit model override when it matches provider model id", async () => {
    mockProviderCatalog(clientStub, createCodexProviderCatalog());

    const session = await ensureCodexBuildSession();

    expectSessionModel(session, TEST_PROVIDER_ID, CODEX_MODEL_PATH);
    expectSelectedModel(clientStub, session.id, CODEX_MODEL_PATH);
  });

  it("keeps explicit plan-mode model overrides when session metadata reports another model", async () => {
    clientStub.session.create.mockResolvedValueOnce({
      ...createMockSession(),
      model: createModel(TEST_PROVIDER_ID, CODEX_MODEL_ID),
    });

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
      model: createModel(TEST_PROVIDER_ID, "opencode/glm-5"),
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

  it("tracks mode transitions from plan to build", async () => {
    const modeEvent = v2Events.stepStarted("build", {
      id: "big-pickle",
      providerID: TEST_PROVIDER_ID,
    });

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

  it("translates native permission and form events before publishing", async () => {
    const published: AgentStreamEvent[] = [];
    const formPublished = Promise.withResolvers<void>();
    useClientStub(
      buildClientStubWithEvents([
        v2Events.permissionAsked({
          id: "permission-stream",
          action: "shell",
          resources: ["bun test"],
        }),
        v2Events.formCreated({
          id: "form-stream",
          title: "Choose a target",
        }),
      ]),
      published,
      (event) => {
        if (
          event.type === "input_required" &&
          event.permissionId === "form-stream"
        ) {
          formPublished.resolve();
        }
      }
    );

    await ensureAgentSession(cellId);
    await formPublished.promise;

    expect(
      published.filter((event) => event.type === "input_required")
    ).toEqual([
      {
        type: "input_required",
        sessionId: RUNTIME_SESSION_ID,
        permissionId: "permission-stream",
        title: "shell",
        kind: "permission",
      },
      {
        type: "input_required",
        sessionId: RUNTIME_SESSION_ID,
        permissionId: "form-stream",
        title: "Choose a target",
        kind: "question",
      },
    ]);
    expect(published.map((event) => event.type)).not.toContain(
      "permission.asked"
    );
    expect(published.map((event) => event.type)).not.toContain("form.created");
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

  it("reports failed v2 session outcomes without inspecting history", async () => {
    const session = await ensureAgentSession(cellId);
    clientStub.session.get.mockResolvedValue({
      ...createMockSession(),
      outcome: "failed",
    });

    const failed = await fetchAgentSession(session.id);

    expect(failed?.status).toBe("error");
    expect(clientStub.spies.listSessionMessages).not.toHaveBeenCalled();
  });

  it("persists resumable working state when a plan question is answered", async () => {
    await startPlanAfterQuestionAnswer(cellId);

    await expectResumeOnStartup(cellId);
  });

  it("restores working status for an active remote session", async () => {
    const session = await prepareActivePersistedResumeSession(clientStub);

    const restored = await fetchAgentSession(session.id);

    expect(restored?.status).toBe("working");
  });

  it("resumes flagged sessions on startup even before assistant streaming resumes", async () => {
    const session = await preparePersistedResumeSession();
    clientStub.session.get.mockResolvedValue({
      ...createMockSession(),
      outcome: "interrupted",
    });

    clientStub.session.prompt.mockClear();

    await resumeAgentSessionsOnStartup();

    expectContinuePrompt(clientStub, session.id);

    await expectResumeOnStartup(cellId);
  });

  it("does not enqueue duplicate resume work for an active session", async () => {
    await prepareActivePersistedResumeSession(clientStub);
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
        (event) => (event as { type?: string }).type === "input_required"
      )
    ).toBe(true);
    await expectResumeOnStartup(cellId, false);
  });

  it("recovers pending form input as Hive input-required state", async () => {
    await persistRuntimeSession(cellId);
    const published: unknown[] = [];
    useClientStub(clientStub, published);
    clientStub.form.list.mockResolvedValue([
      {
        id: "form-1",
        sessionID: RUNTIME_SESSION_ID,
        title: "Choose a deployment target",
        fields: [{ key: "target", type: "string" }],
      },
    ]);

    await resumeAgentSessionsOnStartup();

    expect(clientStub.session.prompt).not.toHaveBeenCalled();
    expect(published).toContainEqual({
      type: "input_required",
      sessionId: RUNTIME_SESSION_ID,
      permissionId: "form-1",
      title: "Choose a deployment target",
      kind: "question",
    });
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
        yield v2Events.executionInterrupted("shutdown");
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
      prepare: () => prepareSessionsForServiceReplacement(clientStub.client),
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
  return createOpenCodeV2ClientFixture({ session: createMockSession() });
}

function createAbortableEventStream(
  signal: AbortSignal | undefined,
  onNext?: () => void
): AsyncIterable<V2Event> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          onNext?.();
          return new Promise<IteratorResult<V2Event>>((resolve) => {
            signal?.addEventListener(
              "abort",
              () => resolve({ done: true, value: undefined }),
              { once: true }
            );
          });
        },
      };
    },
  };
}

function buildClientStubWithEvents(events: V2Event[]): ClientStub {
  return createOpenCodeV2ClientFixture({
    session: createMockSession(),
    events,
  });
}

function createProviderCatalog(
  providerId: string,
  models: Record<string, string>,
  defaultModelId: string
) {
  return createV2ProviderCatalogFixture({
    providers: [{ id: providerId, models }],
    defaults: { [providerId]: defaultModelId },
  });
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
  return createV2ProviderCatalogFixture({ providers, defaults });
}

function mockProviderCatalog(
  client: ClientStub,
  catalog: V2ProviderCatalogFixture
): void {
  applyV2ProviderCatalogFixture(client, catalog);
}

function mockProviderCatalogSequence(
  client: ClientStub,
  ...catalogs: [V2ProviderCatalogFixture, ...V2ProviderCatalogFixture[]]
): void {
  const settled = catalogs.at(-1);
  if (!settled) {
    throw new Error("Expected at least one provider catalog fixture");
  }
  for (const catalog of catalogs.slice(0, -1)) {
    client.spies.listProviders.mockResolvedValueOnce({
      location: client.location,
      data: catalog.providers,
    });
    client.spies.listModels.mockResolvedValueOnce({
      location: client.location,
      data: catalog.models,
    });
    client.spies.getDefaultModel.mockResolvedValueOnce({
      location: client.location,
      data: catalog.default,
    });
  }
  client.spies.listProviders.mockResolvedValue({
    location: client.location,
    data: settled.providers,
  });
  client.spies.listModels.mockResolvedValue({
    location: client.location,
    data: settled.models,
  });
  client.spies.getDefaultModel.mockResolvedValue({
    location: client.location,
    data: settled.default,
  });
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

function createHistoryMessage(input: { id: string; role: string }) {
  const now = Date.now();
  if (input.role === "assistant") {
    return {
      id: input.id,
      type: "assistant" as const,
      agent: "plan",
      model: { providerID: TEST_PROVIDER_ID, id: TEMPLATE_MODEL_ID },
      time: { created: now, completed: now },
      content: [],
    };
  }
  return {
    id: input.id,
    type: "user" as const,
    time: { created: now },
    text: "Continue",
  };
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

async function preparePersistedResumeSession() {
  const session = await ensureAgentSession(TEST_CELL_ID, { startMode: "plan" });

  await closeAllAgentSessions({ deleteRemote: false });
  await markResumeOnStartup(TEST_CELL_ID);

  return session;
}

async function prepareActivePersistedResumeSession(clientStub: ClientStub) {
  const session = await preparePersistedResumeSession();
  clientStub.session.active.mockResolvedValue({
    [session.id]: { type: "running" },
  });
  return session;
}

function createMockSession() {
  return createV2SessionFixture({
    id: RUNTIME_SESSION_ID,
    projectID: "project-1",
    title: "Mock Session",
    directory: TEST_WORKSPACE_PATH,
  });
}
