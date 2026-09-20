import type {
  ModelInfo,
  OpenCodeClient,
  ProviderInfo,
  SessionInfo,
  SessionStructuredError,
  V2Event,
} from "@opencode-ai/client";
import { vi } from "vitest";

type EventOf<Type extends V2Event["type"]> = Extract<V2Event, { type: Type }>;

type ModelFixture = {
  id: string;
  modelID: string;
  providerID: string;
  variants?: ModelInfo["variants"];
};

export type V2ProviderCatalogFixture = {
  providers: ProviderInfo[];
  models: ModelInfo[];
  default: ModelInfo | null;
};

export function createV2SessionFixture(input: {
  id: string;
  projectID: string;
  directory: string;
  title: string;
}): SessionInfo {
  const now = Date.now();
  return {
    id: input.id,
    projectID: input.projectID,
    title: input.title,
    location: { directory: input.directory },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: { created: now, updated: now },
  };
}

export function createV2ModelFixture(input: ModelFixture): ModelInfo {
  return {
    id: input.id,
    modelID: input.modelID,
    providerID: input.providerID,
    name: input.modelID,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: input.variants ?? [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 128_000, output: 16_000 },
  };
}

export function createV2ProviderCatalogFixture(input: {
  providers: Array<{
    id: string;
    models: Record<string, string>;
  }>;
  defaults: Record<string, string>;
}): V2ProviderCatalogFixture {
  const models = input.providers.flatMap((provider) =>
    Object.entries(provider.models).map(([modelID, id]) =>
      createV2ModelFixture({ id, modelID, providerID: provider.id })
    )
  );

  return {
    providers: input.providers.map((provider) => ({
      id: provider.id,
      name: provider.id,
      activation: "enabled",
      package: `@ai-sdk/${provider.id}`,
    })),
    models,
    default:
      models.find(
        (model) => input.defaults[model.providerID] === model.modelID
      ) ?? null,
  };
}

export function applyV2ProviderCatalogFixture(
  fixture: OpenCodeV2ClientFixture,
  catalog: V2ProviderCatalogFixture
): void {
  fixture.spies.listProviders.mockResolvedValue({
    location: fixture.location,
    data: catalog.providers,
  });
  fixture.spies.listModels.mockResolvedValue({
    location: fixture.location,
    data: catalog.models,
  });
  fixture.spies.getDefaultModel.mockResolvedValue({
    location: fixture.location,
    data: catalog.default,
  });
}

export function createOpenCodeV2ClientFixture(input: {
  session: SessionInfo;
  events?: readonly V2Event[];
}) {
  const location = {
    directory: input.session.location.directory,
    project: {
      id: input.session.projectID,
      directory: input.session.location.directory,
      canonical: input.session.location.directory,
    },
  };
  const spies = {
    getActiveSessions: vi.fn<OpenCodeClient["session"]["active"]>(async () =>
      Promise.resolve({})
    ),
    createSession: vi.fn<OpenCodeClient["session"]["create"]>(async () =>
      Promise.resolve(input.session)
    ),
    getSession: vi.fn<OpenCodeClient["session"]["get"]>(async () =>
      Promise.resolve(input.session)
    ),
    interruptSession: vi.fn<OpenCodeClient["session"]["interrupt"]>(async () =>
      Promise.resolve({ interrupted: true })
    ),
    promptSession: vi.fn<OpenCodeClient["session"]["prompt"]>(async () =>
      Promise.resolve({
        id: "inbox-test",
        sessionID: input.session.id,
        timeCreated: Date.now(),
        type: "user",
        payload: { text: "" },
        delivery: "queue",
      })
    ),
    removeSession: vi.fn<OpenCodeClient["session"]["remove"]>(() =>
      Promise.resolve()
    ),
    switchModel: vi.fn<OpenCodeClient["session"]["switchModel"]>(() =>
      Promise.resolve()
    ),
    listInbox: vi.fn<OpenCodeClient["session"]["inbox"]["list"]>(async () =>
      Promise.resolve([])
    ),
    subscribeEvents: vi.fn<OpenCodeClient["event"]["subscribe"]>(() =>
      (async function* () {
        await Promise.resolve();
        for (const event of input.events ?? []) {
          yield event;
        }
      })()
    ),
    listSessionMessages: vi.fn<OpenCodeClient["message"]["list"]>(async () =>
      Promise.resolve({ data: [], cursor: {} })
    ),
    getDefaultModel: vi.fn<OpenCodeClient["model"]["default"]>(async () =>
      Promise.resolve({ location, data: null })
    ),
    listModels: vi.fn<OpenCodeClient["model"]["list"]>(async () =>
      Promise.resolve({ location, data: [] })
    ),
    listForms: vi.fn<OpenCodeClient["form"]["list"]>(async () =>
      Promise.resolve([])
    ),
    listPermissions: vi.fn<OpenCodeClient["permission"]["list"]>(async () =>
      Promise.resolve([])
    ),
    replyPermission: vi.fn<OpenCodeClient["permission"]["reply"]>(() =>
      Promise.resolve()
    ),
    listPlugins: vi.fn<OpenCodeClient["plugin"]["list"]>(async () =>
      Promise.resolve({
        location,
        data: [
          {
            id: "hive.cell.v2.r1.tools-context-shell-permission",
            source: {
              type: "local",
              path: `${input.session.location.directory}/.opencode/plugins/hive/index.js`,
            },
            features: {},
            state: { status: "active" },
          },
        ],
      })
    ),
    listProviders: vi.fn<OpenCodeClient["provider"]["list"]>(async () =>
      Promise.resolve({ location, data: [] })
    ),
    listIntegrations: vi.fn<OpenCodeClient["integration"]["list"]>(async () =>
      Promise.resolve({ location, data: [] })
    ),
  };
  const stub = {
    session: {
      active: spies.getActiveSessions,
      create: spies.createSession,
      get: spies.getSession,
      interrupt: spies.interruptSession,
      prompt: spies.promptSession,
      remove: spies.removeSession,
      switchModel: spies.switchModel,
      inbox: { list: spies.listInbox },
    },
    event: { subscribe: spies.subscribeEvents },
    message: { list: spies.listSessionMessages },
    model: {
      default: spies.getDefaultModel,
      list: spies.listModels,
    },
    form: { list: spies.listForms },
    permission: {
      list: spies.listPermissions,
      reply: spies.replyPermission,
    },
    plugin: { list: spies.listPlugins },
    provider: { list: spies.listProviders },
    integration: { list: spies.listIntegrations },
  };

  return {
    ...stub,
    client: stub as unknown as OpenCodeClient,
    location,
    spies,
  };
}

export type OpenCodeV2ClientFixture = ReturnType<
  typeof createOpenCodeV2ClientFixture
>;

export function createV2EventFixtures(sessionID: string) {
  const base = (type: V2Event["type"]) => ({
    id: `evt-${type}`,
    created: Date.now(),
  });
  const durable = () => ({
    aggregateID: sessionID,
    seq: 1,
    version: 1 as const,
  });

  return {
    sessionIdle: (): EventOf<"session.idle"> => ({
      ...base("session.idle"),
      type: "session.idle",
      data: { sessionID },
    }),
    sessionStatus: (
      status: EventOf<"session.status">["data"]["status"]
    ): EventOf<"session.status"> => ({
      ...base("session.status"),
      type: "session.status",
      data: { sessionID, status },
    }),
    agentSelected: (agent: string): EventOf<"session.agent.selected"> => ({
      ...base("session.agent.selected"),
      type: "session.agent.selected",
      durable: durable(),
      data: { sessionID, agent },
    }),
    stepStarted: (
      agent: string,
      model: EventOf<"session.step.started">["data"]["model"] = {
        id: "model-test",
        providerID: "provider-test",
      }
    ): EventOf<"session.step.started"> => ({
      ...base("session.step.started"),
      type: "session.step.started",
      durable: durable(),
      data: {
        sessionID,
        assistantMessageID: "msg-test",
        agent,
        model,
      },
    }),
    permissionAsked: (input?: {
      id: string;
      action: string;
      resources: string[];
    }): EventOf<"permission.asked"> => ({
      ...base("permission.asked"),
      type: "permission.asked",
      data: {
        id: input?.id ?? "permission-test",
        sessionID,
        action: input?.action ?? "plan_exit",
        resources: input?.resources ?? ["plan_exit"],
        metadata: {},
        save: [],
      },
    }),
    permissionReplied: (): EventOf<"permission.replied"> => ({
      ...base("permission.replied"),
      type: "permission.replied",
      data: { sessionID, requestID: "permission-test", reply: "once" },
    }),
    formCreated: (input?: {
      id: string;
      title: string;
    }): EventOf<"form.created"> => ({
      ...base("form.created"),
      type: "form.created",
      data: {
        form: {
          id: input?.id ?? "question-test",
          sessionID,
          title: input?.title ?? "Continue?",
          fields: [{ key: "continue", type: "boolean" }],
        },
      },
    }),
    formReplied: (): EventOf<"form.replied"> => ({
      ...base("form.replied"),
      type: "form.replied",
      data: {
        id: "question-test",
        sessionID,
        answer: { continue: true },
      },
    }),
    formCancelled: (): EventOf<"form.cancelled"> => ({
      ...base("form.cancelled"),
      type: "form.cancelled",
      data: { id: "question-test", sessionID },
    }),
    executionFailed: (
      error: SessionStructuredError
    ): EventOf<"session.execution.failed"> => ({
      ...base("session.execution.failed"),
      type: "session.execution.failed",
      durable: durable(),
      data: { sessionID, error },
    }),
    executionInterrupted: (
      reason: EventOf<"session.execution.interrupted">["data"]["reason"]
    ): EventOf<"session.execution.interrupted"> => ({
      ...base("session.execution.interrupted"),
      type: "session.execution.interrupted",
      durable: durable(),
      data: { sessionID, reason },
    }),
  };
}
